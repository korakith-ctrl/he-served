import Foundation

enum FormatUtils {
    static func number(_ value: Double?, digits: Int = 0) -> String {
        value.map { $0.formatted(.number.precision(.fractionLength(digits))) } ?? "—"
    }

    static func sleepDuration(_ minutes: Double?) -> String {
        guard let minutes else { return "—" }
        let n = Int(minutes.rounded())
        return "\(n / 60) ชม. \(n % 60) นาที"
    }

    static func thaiDate(_ key: String) -> String {
        let parts = key.split(separator: "-")
        guard parts.count == 3, let month = Int(parts[1]), let day = Int(parts[2]), (1...12).contains(month) else { return key }
        let names = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]
        return "\(day) \(names[month - 1])"
    }
}

