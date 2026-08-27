import AVFoundation
import SwiftUI

/// La app ES el servicio.
///
/// Antes había tres piezas sueltas: launchd para levantarlo, `start-voice-tmux.sh`
/// para darle un stdin escribible, y el HUD de tkinter adivinando el estado con
/// un tail del log. Acá la app lanza el proceso, le habla por el PTY que ella
/// misma abrió, y lee su salida directa. Nada que adivinar.
@main
struct HermesVoiceApp: App {
    @StateObject private var demonio = DaemonSupervisor()
    @StateObject private var estado  = VoiceState()
    @StateObject private var micro   = MicMeter()
    @StateObject private var config  = ConfigStore()
    @StateObject private var feed    = ActivityFeed()
    private let log = LogTail()
    @StateObject private var mini = MiniOrbController()

    var body: some Scene {
        Window("Hermes Voz", id: "principal") {
            ContentView()
                .environmentObject(demonio)
                .environmentObject(estado)
                .environmentObject(micro)
                .environmentObject(config)
                .environmentObject(mini)
                .environmentObject(feed)
                .task { conectar() }
        }
        .windowResizability(.contentSize)
        .defaultSize(width: 380, height: 620)
    }

    @MainActor
    private func conectar() {
        // EL ESTADO SE LEE DEL LOG, no del PTY. Medido en el arranque del
        // demonio: 79 saltos de línea contra 452 secuencias de escape y 99
        // retornos de carro — la TUI se redibuja en el lugar, su salida es una
        // pantalla y no un registro. El PTY queda para ESCRIBIR.
        log.alRecibirLinea = { linea in
            Task { @MainActor in
                estado.consumir(linea)
                feed.consumir(linea)
                // NO se enciende el medidor solo. PROBADO DOS VECES que el
                // micrófono no se comparte con el demonio:
                //   1) medidor antes que el wake word -> el wake word queda
                //      clavado en "opening microphone", no llega a "listening"
                //   2) medidor DESPUÉS de "listening" -> un segundo más tarde
                //      aparece "wake word: stream closed" y la app se cae
                // El micrófono es de uno solo. Medir pausa la escucha: es el
                // botón "medir", que manda /wake off primero.
            }
        }
        log.arrancar()
        // PEDIR EL PERMISO DE MICRÓFONO ANTES DE LANZAR AL HIJO.
        //
        // TCC le atribuye el acceso al proceso RESPONSABLE, y para un hijo que
        // lanza esta app la responsable es la app. Bajo launchd el responsable
        // era otro y ya tenía permiso; acá hay que pedirlo explícitamente o el
        // hijo se queda colgado en "opening microphone" sin llegar nunca a
        // "listening" — exactamente lo que pasó en la primera prueba.
        //
        // Se PIDE el permiso sin quedarse con el device: sostenerlo sería la
        // contención que ya nos mordió.
        AVCaptureDevice.requestAccess(for: .audio) { concedido in
            Task { @MainActor in
                if !concedido {
                    self.micro.reportar("sin permiso de micrófono — Ajustes › Privacidad › Micrófono")
                }
                if case .detenido = self.demonio.status { self.demonio.arrancar() }
            }
        }
        // El medidor NO arranca solo, a propósito. El wake word del demonio
        // tiene el micrófono tomado de forma permanente, y una segunda toma lo
        // deja clavado en "opening microphone" sin llegar nunca a "listening"
        // — verificado en la primera prueba de esta app. Medir es un acto
        // deliberado que pausa la escucha; ver el botón "medir" en la interfaz.
    }
}
