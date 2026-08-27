import Foundation

/// Lee y escribe las perillas del perfil de voz.
///
/// Sin dependencias de YAML a propósito: solo toca claves escalares conocidas
/// y las reemplaza en su línea, dejando intactos los comentarios. Ese archivo
/// tiene el registro de POR QUÉ cada valor es el que es —mediciones, números
/// de línea del código de Hermes, cosas que costaron horas de encontrar— y un
/// serializador de YAML los borraría todos.
@MainActor
final class ConfigStore: ObservableObject {

    @Published var bargeIn = false
    @Published var umbralSilencio = 200
    @Published var duracionSilencio = 1.5
    @Published var continuoTrasWake = true
    @Published var error: String?

    private let ruta = "/Users/robert/.hermes/profiles/voice/config.yaml"

    init() { cargar() }

    func cargar() {
        guard let texto = try? String(contentsOfFile: ruta, encoding: .utf8) else {
            error = "no se pudo leer config.yaml"
            return
        }
        bargeIn          = Self.leerBool(texto, "barge_in") ?? false
        umbralSilencio   = Self.leerInt(texto, "silence_threshold") ?? 200
        duracionSilencio = Self.leerDouble(texto, "silence_duration") ?? 1.5
        continuoTrasWake = Self.leerBool(texto, "continuous_after_wake") ?? true
        error = nil
    }

    /// Devuelve true si algo cambió en disco (o sea, si hace falta reiniciar).
    @discardableResult
    func guardar() -> Bool {
        guard var texto = try? String(contentsOfFile: ruta, encoding: .utf8) else {
            error = "no se pudo leer config.yaml"
            return false
        }
        let antes = texto
        texto = Self.escribir(texto, "barge_in", bargeIn ? "true" : "false")
        texto = Self.escribir(texto, "silence_threshold", String(umbralSilencio))
        texto = Self.escribir(texto, "silence_duration", String(format: "%.1f", duracionSilencio))
        texto = Self.escribir(texto, "continuous_after_wake", continuoTrasWake ? "true" : "false")
        guard texto != antes else { return false }
        do {
            try texto.write(toFile: ruta, atomically: true, encoding: .utf8)
            error = nil
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    // MARK: - Lectura y escritura por línea

    /// Solo mira líneas indentadas `clave: valor`, nunca comentarios: varias de
    /// estas claves aparecen citadas DENTRO de los comentarios explicativos.
    private static func patron(_ clave: String) -> NSRegularExpression {
        try! NSRegularExpression(pattern: "(?m)^([ \\t]+)\(clave):[ \\t]*([^#\\n]*)")
    }

    private static func valorCrudo(_ texto: String, _ clave: String) -> String? {
        let r = NSRange(texto.startIndex..., in: texto)
        guard let m = patron(clave).firstMatch(in: texto, range: r),
              let rr = Range(m.range(at: 2), in: texto) else { return nil }
        return String(texto[rr]).trimmingCharacters(in: .whitespaces)
    }

    private static func leerBool(_ t: String, _ k: String) -> Bool? {
        guard let v = valorCrudo(t, k)?.lowercased() else { return nil }
        return v == "true" ? true : (v == "false" ? false : nil)
    }
    private static func leerInt(_ t: String, _ k: String) -> Int? {
        guard let v = valorCrudo(t, k) else { return nil }
        return Int(v)
    }
    private static func leerDouble(_ t: String, _ k: String) -> Double? {
        guard let v = valorCrudo(t, k) else { return nil }
        return Double(v)
    }

    private static func escribir(_ texto: String, _ clave: String, _ valor: String) -> String {
        let r = NSRange(texto.startIndex..., in: texto)
        guard let m = patron(clave).firstMatch(in: texto, range: r),
              let rangoLinea = Range(m.range, in: texto),
              let rangoSangria = Range(m.range(at: 1), in: texto) else { return texto }
        let sangria = String(texto[rangoSangria])
        return texto.replacingCharacters(in: rangoLinea, with: "\(sangria)\(clave): \(valor)")
    }
}
