import Foundation

struct SyncClient {
    func upload(payload: HealthSyncPayload, endpoint: String, token: String) async throws -> HealthSyncResponse {
        guard let url = URL(string: endpoint), url.scheme == "https" else { throw SyncError.invalidEndpoint }
        guard token.count >= 32 else { throw SyncError.missingToken }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 45
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(payload)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw SyncError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONDecoder().decode(ErrorResponse.self, from: data).error) ?? "HTTP \(http.statusCode)"
            throw SyncError.server(message)
        }
        return try JSONDecoder().decode(HealthSyncResponse.self, from: data)
    }

    private struct ErrorResponse: Codable { let error: String }

    enum SyncError: LocalizedError {
        case invalidEndpoint
        case missingToken
        case invalidResponse
        case server(String)

        var errorDescription: String? {
            switch self {
            case .invalidEndpoint: "Sync endpoint ไม่ถูกต้อง"
            case .missingToken: "กรุณาวาง pairing token จากเว็บ Recomp"
            case .invalidResponse: "ไม่ได้รับคำตอบที่ถูกต้องจากเซิร์ฟเวอร์"
            case .server(let message): "เซิร์ฟเวอร์ปฏิเสธข้อมูล: \(message)"
            }
        }
    }
}
