import Foundation
import SwiftUI

/// Máquina de estados del turno, alimentada por las líneas del demonio.
///
/// Los patrones vienen del HUD de tkinter, donde ya se validaron contra log
/// real. La diferencia es la fuente: allá era un tail del `agent.log`, acá es
/// la salida directa del proceso que esta app tiene en la mano.
@MainActor
final class VoiceState: ObservableObject {

    enum Fase: String {
        case reposo         = "en reposo"
        case desperto       = "despertó"
        case escuchando     = "escuchando"
        case transcribiendo = "transcribiendo"
        case pensando       = "pensando"
        case generando      = "generando voz"
        case hablando       = "hablando"
        case error          = "error"
        case detenida       = "escucha detenida"

        var color: Color {
            switch self {
            case .reposo:         return Color(red: 0.42, green: 0.45, blue: 0.50)
            case .desperto:       return Color(red: 0.96, green: 0.77, blue: 0.26)
            case .escuchando:     return Color(red: 0.90, green: 0.33, blue: 0.29)
            case .transcribiendo: return Color(red: 0.29, green: 0.62, blue: 0.88)
            case .pensando:       return Color(red: 0.71, green: 0.49, blue: 0.86)
            case .generando:      return Color(red: 0.88, green: 0.55, blue: 0.29)
            case .hablando:       return Color(red: 0.36, green: 0.72, blue: 0.35)
            case .error:          return Color(red: 0.90, green: 0.33, blue: 0.29)
            case .detenida:       return Color(red: 0.88, green: 0.55, blue: 0.29)
            }
        }

        /// La app respira mientras trabaja; quieta cuando no hay nada en curso.
        var pulsa: Bool {
            switch self {
            case .escuchando, .pensando, .generando, .hablando: return true
            default: return false
            }
        }
    }

    @Published private(set) var fase: Fase = .reposo
    @Published private(set) var detalle: String?
    @Published private(set) var sesion: String = ""
    @Published private(set) var turno: Int = 0
    @Published private(set) var grabando = false

    private var silencios = 0

    private static func re(_ p: String) -> NSRegularExpression {
        try! NSRegularExpression(pattern: p, options: [.caseInsensitive])
    }

    private static let estados: [(NSRegularExpression, Fase)] = [
        (re("phrase detected|Wake word detected"),      .desperto),
        (re("Recording\\.\\.\\.|recording started|● REC"), .escuchando),
        (re("Transcribing|Transcribed |recording stopped"), .transcribiendo),
        (re("Initializing agent|conversation turn|API call #"), .pensando),
        (re("Generating speech"),                        .generando),
        (re("TTS audio saved"),                          .hablando),
        (re("Wake word listening|wake word: listening"),  .reposo),
    ]

    // El aviso de que un ciclo pasó sin voz. Tres seguidos apagan el modo
    // continuo, y lo hacen EN SILENCIO: sin este cartel es indistinguible de
    // un grabador colgado.
    private static let ciclosSinVoz = re("No speech detected|No speech within|Recording too quiet|SIN AUDIO")
    private static let errores      = re("Non-retryable client error|returned error|Failed to start wake word|Timed out while opening")
    private static let sesionRe     = re("session=([A-Za-z0-9_]+)")

    func consumir(_ linea: String) {
        let rango = NSRange(linea.startIndex..., in: linea)

        if Self.errores.firstMatch(in: linea, range: rango) != nil {
            fase = .error
            detalle = Self.compactar(linea)
            return
        }

        if let m = Self.sesionRe.firstMatch(in: linea, range: rango),
           let r = Range(m.range(at: 1), in: linea) {
            let id = String(linea[r])
            if id != sesion { sesion = id; turno = 0 }
            turno += 1
        }

        if Self.ciclosSinVoz.firstMatch(in: linea, range: rango) != nil {
            silencios += 1
            if silencios >= 3 {
                fase = .detenida
                detalle = "tres silencios seguidos: el modo continuo se apagó. La sesión sigue viva."
                silencios = 0
                grabando = false
                return
            }
        } else if linea.contains("Transcribed ") {
            silencios = 0
        }

        for (patron, nueva) in Self.estados where patron.firstMatch(in: linea, range: rango) != nil {
            fase = nueva
            if nueva == .escuchando { grabando = true }
            if nueva == .transcribiendo || nueva == .reposo { grabando = false }
            if nueva != .error { detalle = nil }
            break
        }
    }

    func nuevaSesion() {
        sesion = ""
        turno = 0
        detalle = nil
        silencios = 0
    }

    /// El mensaje humano de un 400 viene enterrado en el repr de un dict de
    /// Python dentro del texto del log.
    static func compactar(_ crudo: String) -> String {
        if let r = try? NSRegularExpression(pattern: "'message':\\s*'([^']+)'"),
           let m = r.firstMatch(in: crudo, range: NSRange(crudo.startIndex..., in: crudo)),
           let rr = Range(m.range(at: 1), in: crudo) {
            return String(crudo[rr])
        }
        return String(crudo.prefix(140))
    }
}
