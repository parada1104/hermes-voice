import Foundation

/// Sigue el `agent.log` del perfil, línea por línea.
///
/// La primera versión de la app leía el estado del flujo crudo del PTY, y casi
/// no reaccionaba. Medido: en 8 segundos de arranque el demonio emite 79 saltos
/// de línea contra **452 secuencias de escape y 99 retornos de carro** — la TUI
/// se redibuja en el lugar, así que su salida es una pantalla, no un registro.
/// El PTY sirve para ESCRIBIR (Ctrl+B, slash commands); para LEER estado, el
/// log es la fuente correcta: una línea por evento, con marca de tiempo.
///
/// Es la misma técnica que ya funcionaba en el HUD de tkinter.
final class LogTail: @unchecked Sendable {

    private let ruta = "/Users/robert/.hermes/profiles/voice/logs/agent.log"
    private var handle: FileHandle?
    private var offset: UInt64 = 0
    private var timer: DispatchSourceTimer?
    private var resto = ""

    /// Se llama por cada línea nueva, ya en el hilo principal.
    var alRecibirLinea: ((String) -> Void)?

    func arrancar() {
        abrir()
        let t = DispatchSource.makeTimerSource(queue: .global(qos: .utility))
        t.schedule(deadline: .now(), repeating: .milliseconds(200))
        t.setEventHandler { [weak self] in self?.leer() }
        t.resume()
        timer = t
    }

    func detener() {
        timer?.cancel()
        timer = nil
        try? handle?.close()
        handle = nil
    }

    private func abrir() {
        handle = FileHandle(forReadingAtPath: ruta)
        // Solo lo que pase de ahora en más: el histórico dispararía estados viejos.
        if let fin = try? handle?.seekToEnd() { offset = fin }
    }

    private func leer() {
        guard let h = handle else { abrir(); return }
        // Un reinicio del demonio rota o trunca el log; si encogió, reabrimos
        // en vez de quedarnos leyendo un descriptor muerto.
        if let attrs = try? FileManager.default.attributesOfItem(atPath: ruta),
           let tam = (attrs[.size] as? NSNumber)?.uint64Value, tam < offset {
            try? h.close()
            handle = nil
            abrir()
            return
        }
        guard let datos = try? h.readToEnd(), !datos.isEmpty else { return }
        offset += UInt64(datos.count)
        guard let texto = String(data: datos, encoding: .utf8) else { return }

        resto += texto
        var lineas: [String] = []
        while let corte = resto.firstIndex(of: "\n") {
            let l = String(resto[resto.startIndex..<corte]).trimmingCharacters(in: .whitespaces)
            resto = String(resto[resto.index(after: corte)...])
            if !l.isEmpty { lineas.append(l) }
        }
        guard !lineas.isEmpty else { return }
        let entregar = lineas
        DispatchQueue.main.async { [weak self] in
            for l in entregar { self?.alRecibirLinea?(l) }
        }
    }
}
