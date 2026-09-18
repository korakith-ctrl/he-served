import Foundation
import Security

enum NativeKeychain {
    private static let service = "com.korakritinsa.recomp.native"
    private static let account = "pairing-token"

    static func load() -> String {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return "" }
        return String(decoding: data, as: UTF8.self)
    }

    static func save(_ value: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
        var attributes = query
        attributes[kSecValueData as String] = Data(value.utf8)
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        guard SecItemAdd(attributes as CFDictionary, nil) == errSecSuccess else {
            throw NativeError.keychain
        }
    }

    static func remove() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}

enum NativeError: LocalizedError {
    case keychain, invalidConnection, invalidResponse, server(String)

    var errorDescription: String? {
        switch self {
        case .keychain: "เก็บรหัสเชื่อมต่อใน Keychain ไม่สำเร็จ"
        case .invalidConnection: "ข้อมูลเชื่อมต่อไม่ถูกต้อง"
        case .invalidResponse: "เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง"
        case .server(let message): "เชื่อมต่อไม่สำเร็จ: \(message)"
        }
    }
}
