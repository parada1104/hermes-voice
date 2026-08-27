import AVFoundation
import Foundation

/// Medidor de micrófono en vivo.
///
/// Existe porque el HUD anterior NO veía el micrófono: deducía el estado
/// leyendo el log. Los números que hicieron falta para calibrar (piso de sala,
/// sangrado del altavoz, nivel de voz) hubo que sacarlos a mano con scripts
/// sueltos. Acá se ven solos y todo el tiempo.
///
/// Escala: RMS 0-32767, la misma que usa `voice.silence_threshold` en el
/// config, para que lo que se ve acá se pueda comparar con lo configurado sin
/// convertir nada.
@MainActor
final class MicMeter: ObservableObject {

    @Published private(set) var rms: Int = 0
    @Published private(set) var pico: Int = 0
    @Published private(set) var saturado = false
    @Published private(set) var activo = false
    @Published private(set) var error: String?

    /// Con AEC encendido el micrófono entrega la señal ya limpia del audio que
    /// sale por el altavoz. Es LA razón de que la app sea nativa: medido en
    /// este equipo, el sangrado del altavoz (p90 2610) ahoga la voz de Robert
    /// (161-588), así que sin cancelación no existe umbral que los separe y el
    /// barge-in es imposible. `setVoiceProcessingEnabled` es la unidad de
    /// Apple (la de FaceTime/Siri) e incluye además control de ganancia.
    @Published var cancelacionEco = false {
        didSet { if activo { reiniciarMotor() } }
    }

    private let motor = AVAudioEngine()
    private var corriendo = false

    /// Por encima de esto se considera saturación: 0 dBFS es 32767, así que
    /// ~-3 dBFS deja margen antes del recorte real.
    private let umbralSaturacion = 23000

    func reportar(_ mensaje: String) { error = mensaje }

    func arrancar() {
        guard !corriendo else { return }
        let entrada = motor.inputNode

        if cancelacionEco {
            do {
                try entrada.setVoiceProcessingEnabled(true)
            } catch {
                self.error = "sin cancelación de eco: \(error.localizedDescription)"
            }
        }

        // AVAudioEngine lanza excepciones de ObjC que Swift NO puede atrapar:
        // un formato inválido no da error, tumba el proceso. Por eso se valida
        // ANTES de instalar el tap. Es lo que hacía explotar la app cuando el
        // demonio ya tenía el micrófono tomado.
        let formato = entrada.outputFormat(forBus: 0)
        guard formato.sampleRate > 0, formato.channelCount > 0 else {
            self.error = "micrófono ocupado por el asistente — usá el botón medir"
            return
        }

        instalarTap(entrada, formato)

        do {
            motor.prepare()
            try motor.start()
            corriendo = true
            activo = true
            error = nil
        } catch {
            self.error = error.localizedDescription
            entrada.removeTap(onBus: 0)
        }
    }

    func detener() {
        guard corriendo else { return }
        motor.inputNode.removeTap(onBus: 0)
        motor.stop()
        corriendo = false
        activo = false
        rms = 0
        pico = 0
        saturado = false
    }

    /// `nonisolated` NO es decorativo: sin esto la clausura hereda el
    /// aislamiento `@MainActor` de la clase, y como el tap corre en el hilo de
    /// audio en TIEMPO REAL, Swift 6 dispara la aserción de ejecutor y ABORTA
    /// el proceso. El crash se veía como `_dispatch_assert_queue_fail` ->
    /// `swift_task_isCurrentExecutorWithFlags` -> `closure #1 in arrancar()`,
    /// y parecía que fallaba el micrófono cuando en realidad fallaba el
    /// modelo de concurrencia.
    nonisolated private func instalarTap(_ entrada: AVAudioInputNode,
                                         _ formato: AVAudioFormat) {
        entrada.installTap(onBus: 0, bufferSize: 1024, format: formato) { [weak self] buffer, _ in
            guard let canal = buffer.floatChannelData?[0] else { return }
            let n = Int(buffer.frameLength)
            guard n > 0 else { return }
            var suma: Float = 0
            var maximo: Float = 0
            for i in 0..<n {
                let v = canal[i]
                suma += v * v
                maximo = max(maximo, abs(v))
            }
            // A la misma escala entera que usa Hermes para sus umbrales.
            let valorRMS = Int((suma / Float(n)).squareRoot() * 32767)
            let valorPico = Int(maximo * 32767)
            Task { @MainActor in self?.publicar(rms: valorRMS, pico: valorPico) }
        }
    }

    private func reiniciarMotor() {
        detener()
        arrancar()
    }

    private func publicar(rms nuevo: Int, pico nuevoPico: Int) {
        // Suavizado asimétrico: sube al instante para que el medidor se sienta
        // reactivo, baja despacio para que el ojo alcance a leer el pico.
        rms = nuevo > rms ? nuevo : (rms * 7 + nuevo) / 8
        pico = max(nuevoPico, (pico * 15) / 16)
        saturado = nuevoPico >= umbralSaturacion
    }
}
