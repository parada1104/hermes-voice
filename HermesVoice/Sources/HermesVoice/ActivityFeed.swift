import Foundation
import SwiftUI

/// Qué está haciendo el asistente, en palabras.
///
/// El orbe dice en qué FASE está, pero no QUÉ hizo. Cuando un turno tarda
/// quince segundos, "pensando" no distingue entre tres búsquedas en el
/// navegador y un modelo trabado. Esto convierte las líneas del log en un
/// registro legible, con el tiempo que costó cada paso.
@MainActor
final class ActivityFeed: ObservableObject {

    struct Evento: Identifiable {
        let id = UUID()
        let hora: String
        let icono: String
        let titulo: String
        let detalle: String?
        let color: Color
    }

    @Published private(set) var eventos: [Evento] = []
    private let maximo = 60

    var ultimo: Evento? { eventos.last }

    private static func re(_ p: String) -> NSRegularExpression {
        try! NSRegularExpression(pattern: p)
    }

    // Formatos verificados contra el agent.log real.
    private static let herramienta = re("tool ([a-z_]+) completed \\(([0-9.]+)s, ([0-9]+) chars\\)")
    private static let herramientaFalla = re("Tool ([a-z_]+) returned error[^:]*: (.+)")
    private static let llamada = re("API call #([0-9]+): model=(\\S+).*?latency=([0-9.]+)s")
    private static let transcrito = re("Transcribed \\S+ .*?\\(([^,]+), ([0-9]+) chars\\)")
    private static let vozLista = re("TTS audio saved: \\S+ \\(([0-9,]+) bytes")
    private static let grabando = re("Voice recording stopped \\(([0-9.]+)s")
    private static let horaRe = re("^([0-9]{2}:[0-9]{2}:[0-9]{2})")

    /// Nombres de herramienta en castellano: "computer_use" no le dice nada a
    /// nadie mientras escucha una respuesta hablada.
    private static let nombres: [String: (String, String)] = [
        "computer_use":    ("🖥", "mirando la pantalla"),
        "terminal":        ("⌘", "corriendo un comando"),
        "browser_navigate":("🌐", "navegando"),
        "read_file":       ("📄", "leyendo un archivo"),
        "write_file":      ("✎", "escribiendo un archivo"),
        "patch":           ("✎", "editando un archivo"),
        "search_files":    ("🔎", "buscando archivos"),
        "delegate_task":   ("⇢", "delegando a un subagente"),
        "vision_analyze":  ("👁", "analizando una imagen"),
        "skill_view":      ("📚", "leyendo una skill"),
        "skills_list":     ("📚", "listando skills"),
        "execute_code":    ("⚙", "ejecutando código"),
    ]

    func consumir(_ linea: String) {
        let r = NSRange(linea.startIndex..., in: linea)
        let hora = Self.capturar(Self.horaRe, linea, 1)
            ?? Self.capturarHoraDeLog(linea) ?? ""

        if let m = Self.herramienta.firstMatch(in: linea, range: r) {
            let tool = Self.texto(m, 1, linea)
            let seg  = Self.texto(m, 2, linea)
            let chars = Int(Self.texto(m, 3, linea)) ?? 0
            let (icono, desc) = Self.nombres[tool] ?? ("•", tool)
            // El tamaño del resultado importa: una captura de pantalla de 30k
            // caracteres es lo que hacía reventar al proveedor con un 400.
            let peso = chars > 20000 ? " · \(chars / 1000)k caracteres" : ""
            agregar(hora, icono, desc, "\(seg)s\(peso)", .white.opacity(0.75))
            return
        }
        if let m = Self.herramientaFalla.firstMatch(in: linea, range: r) {
            agregar(hora, "⚠", "falló \(Self.texto(m, 1, linea))",
                    VoiceState.compactar(Self.texto(m, 2, linea)),
                    Color(red: 0.90, green: 0.33, blue: 0.29))
            return
        }
        if let m = Self.llamada.firstMatch(in: linea, range: r) {
            agregar(hora, "◆", "consultando al modelo",
                    "\(Self.texto(m, 3, linea))s · llamada \(Self.texto(m, 1, linea))",
                    Color(red: 0.71, green: 0.49, blue: 0.86))
            return
        }
        if let m = Self.transcrito.firstMatch(in: linea, range: r) {
            agregar(hora, "✍", "te transcribió",
                    "\(Self.texto(m, 2, linea)) caracteres",
                    Color(red: 0.29, green: 0.62, blue: 0.88))
            return
        }
        if let m = Self.grabando.firstMatch(in: linea, range: r) {
            agregar(hora, "🎙", "te escuchó", "\(Self.texto(m, 1, linea))s",
                    Color(red: 0.90, green: 0.33, blue: 0.29))
            return
        }
        if Self.vozLista.firstMatch(in: linea, range: r) != nil {
            agregar(hora, "🔊", "hablando", nil, Color(red: 0.36, green: 0.72, blue: 0.35))
            return
        }
        if linea.contains("Non-retryable client error") {
            agregar(hora, "⛔", "el proveedor rechazó la petición",
                    VoiceState.compactar(linea),
                    Color(red: 0.90, green: 0.33, blue: 0.29))
        }
    }

    func limpiar() { eventos.removeAll() }

    private func agregar(_ hora: String, _ icono: String, _ titulo: String,
                         _ detalle: String?, _ color: Color) {
        eventos.append(Evento(hora: hora, icono: icono, titulo: titulo,
                              detalle: detalle, color: color))
        if eventos.count > maximo { eventos.removeFirst(eventos.count - maximo) }
    }

    // MARK: - Auxiliares

    private static func texto(_ m: NSTextCheckingResult, _ i: Int, _ s: String) -> String {
        guard let r = Range(m.range(at: i), in: s) else { return "" }
        return String(s[r])
    }
    private static func capturar(_ re: NSRegularExpression, _ s: String, _ i: Int) -> String? {
        guard let m = re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)),
              let r = Range(m.range(at: i), in: s) else { return nil }
        return String(s[r])
    }
    /// Las líneas del log empiezan con "2026-08-15 17:51:40,394".
    private static func capturarHoraDeLog(_ s: String) -> String? {
        guard s.count > 19 else { return nil }
        let i = s.index(s.startIndex, offsetBy: 11)
        let j = s.index(s.startIndex, offsetBy: 19)
        let h = String(s[i..<j])
        return h.contains(":") ? h : nil
    }
}
