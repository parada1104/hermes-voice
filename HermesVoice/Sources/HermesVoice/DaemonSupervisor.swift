import Foundation

/// Dueño del proceso del asistente de voz.
///
/// Reemplaza a launchd + `start-voice-tmux.sh` + `tmux send-keys`. Ese puente
/// existía por una sola razón: el demonio corría bajo `script -q /dev/null`,
/// que le daba un PTY pero dejaba su stdin en manos de launchd, así que no
/// había forma de mandarle nada. Después se pasó a tmux para conseguir un
/// stdin escribible, y el HUD terminó adivinando el estado parseando
/// `capture-pane`.
///
/// Acá no hace falta adivinar: la app ES el proceso padre. Abre el PTY ella
/// misma, escribe en el maestro y lee la salida directa.
@MainActor
final class DaemonSupervisor: ObservableObject {

    enum Status: Equatable {
        case detenido
        case arrancando
        case corriendo
        case caido(String)
    }

    @Published private(set) var status: Status = .detenido
    /// Últimas líneas del demonio, ya sin secuencias ANSI.
    @Published private(set) var salida: [String] = []
    /// Se dispara con cada línea nueva; de acá se alimenta la máquina de estados.
    var alRecibirLinea: ((String) -> Void)?

    private var proceso: Process?
    private var maestro: FileHandle?
    private var buffer = ""
    private let maxLineas = 400

    private let ejecutable = "/Users/robert/.local/bin/voice"
    private let hermesHome = "/Users/robert/.hermes/profiles/voice"

    // MARK: - Ciclo de vida

    func arrancar() {
        guard proceso == nil else { return }
        status = .arrancando

        // Hermes dibuja una TUI: sin PTY se comporta como si no hubiera
        // terminal y no emite ni el prompt ni la barra de estado.
        var fdMaestro: Int32 = 0
        var fdEsclavo: Int32 = 0
        var ventana = winsize(ws_row: 40, ws_col: 120, ws_xpixel: 0, ws_ypixel: 0)
        guard openpty(&fdMaestro, &fdEsclavo, nil, nil, &ventana) == 0 else {
            status = .caido("no se pudo abrir el PTY")
            return
        }

        let p = Process()
        p.executableURL = URL(fileURLWithPath: ejecutable)
        // Continuidad + delegación: reanuda la sesión canónica "Bot Chat" del
        // perfil voice (creada por la primera interacción / el CLI). Sin esto
        // cada arranque abriría una sesión plana nueva: sin historial y sin
        // message_agent (el protocolo bot-mode solo se inyecta en el Bot Chat
        // canónico). OJO: NO usar --create-if-missing aquí — en modo TUI
        // global (--cli) ese flag no existe y el arranque muere con exit 2.
        p.arguments = ["--cli", "-c", "Bot Chat"]

        var entorno = ProcessInfo.processInfo.environment
        entorno["HERMES_HOME"] = hermesHome
        // Mismas variables que traía el plist: sin esto el perfil carga otro
        // SOUL.md y otra memoria (ver el contrato de delegación en config.yaml).
        entorno["HERMES_IGNORE_RULES"] = "1"
        entorno["HERMES_LOCAL_STT_COMMAND"] =
            "/Users/robert/.hermes/voice/omlx-stt {input_path} --output_dir {output_dir}"
            + " --language {language} --model {model}"
        entorno["TERM"] = "xterm-256color"
        p.environment = entorno

        let esclavo = FileHandle(fileDescriptor: fdEsclavo, closeOnDealloc: false)
        p.standardInput = esclavo
        p.standardOutput = esclavo
        p.standardError = esclavo

        let m = FileHandle(fileDescriptor: fdMaestro, closeOnDealloc: false)
        m.readabilityHandler = { [weak self] h in
            let datos = h.availableData
            guard !datos.isEmpty, let texto = String(data: datos, encoding: .utf8) else { return }
            Task { @MainActor in self?.consumir(texto) }
        }
        maestro = m

        p.terminationHandler = { [weak self] proc in
            Task { @MainActor in
                self?.alTerminar(codigo: proc.terminationStatus)
            }
        }

        do {
            try p.run()
            proceso = p
            status = .corriendo
        } catch {
            status = .caido(error.localizedDescription)
            close(fdMaestro)
            close(fdEsclavo)
        }
        // El hijo se queda con el esclavo; el padre no lo necesita.
        close(fdEsclavo)
    }

    func detener() {
        maestro?.readabilityHandler = nil
        proceso?.terminate()
        proceso = nil
        try? maestro?.close()
        maestro = nil
        status = .detenido
    }

    func reiniciar() {
        detener()
        // Un respiro para que CoreAudio suelte el micrófono: reabrirlo de
        // inmediato es lo que dispara los `PaMacCore err=-50`.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            self?.arrancar()
        }
    }

    private func alTerminar(codigo: Int32) {
        proceso = nil
        maestro?.readabilityHandler = nil
        maestro = nil
        if status != .detenido {
            status = .caido("terminó con código \(codigo)")
        }
    }

    // MARK: - Entrada

    /// Manda bytes crudos. `Ctrl+B` es `\u{02}` y es la tecla de grabar.
    func enviar(_ texto: String) {
        guard let datos = texto.data(using: .utf8) else { return }
        try? maestro?.write(contentsOf: datos)
    }

    func alternarGrabacion() { enviar("\u{02}") }

    /// Limpia lo tipeado antes de escribir, por si quedó algo a medias.
    func comando(_ slash: String) {
        enviar("\u{15}")          // Ctrl+U
        enviar(slash + "\n")
    }

    // MARK: - Salida

    private func consumir(_ texto: String) {
        buffer += texto
        while let corte = buffer.firstIndex(of: "\n") {
            let cruda = String(buffer[buffer.startIndex..<corte])
            buffer = String(buffer[buffer.index(after: corte)...])
            let limpia = Self.sinANSI(cruda).trimmingCharacters(in: .whitespaces)
            guard !limpia.isEmpty else { continue }
            salida.append(limpia)
            if salida.count > maxLineas { salida.removeFirst(salida.count - maxLineas) }
            alRecibirLinea?(limpia)
        }
    }

    /// La TUI escupe muchísimo escape de color y posicionamiento; sin sacarlo
    /// las expresiones regulares de estado no aciertan nunca.
    static func sinANSI(_ s: String) -> String {
        guard let re = try? NSRegularExpression(pattern: "\u{1B}\\[[0-9;?]*[a-zA-Z]") else { return s }
        let r = NSRange(s.startIndex..., in: s)
        return re.stringByReplacingMatches(in: s, range: r, withTemplate: "")
    }
}
