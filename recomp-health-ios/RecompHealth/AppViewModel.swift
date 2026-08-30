import Foundation
import Combine

@MainActor
final class AppViewModel: ObservableObject {
    @Published var profileId: String
    @Published var endpoint: String
    @Published var token: String
    @Published var status = "รอการตั้งค่า"
    @Published var isBusy = false
    @Published var isAuthorized = false
    @Published var lastSyncedAt: Date?
    @Published var lastDays = 0
    @Published var lastWorkouts = 0

    private let health = HealthKitManager()
    private let client = SyncClient()
    private let defaults = UserDefaults.standard

    init() {
        profileId = defaults.string(forKey: "profileId") ?? "zackdark"
        endpoint = defaults.string(forKey: "endpoint") ?? "https://asia-southeast1-he-served.cloudfunctions.net/syncAppleHealth"
        token = KeychainStore.load()
        if let value = defaults.object(forKey: "lastSyncedAt") as? Date { lastSyncedAt = value }
        if !token.isEmpty { status = "พร้อมซิงก์" }
    }

    func saveConnection() {
        do {
            endpoint = endpoint.trimmingCharacters(in: .whitespacesAndNewlines)
            token = token.trimmingCharacters(in: .whitespacesAndNewlines)
            defaults.set(profileId, forKey: "profileId")
            defaults.set(endpoint, forKey: "endpoint")
            try KeychainStore.save(token)
            status = "บันทึก pairing ใน Keychain แล้ว"
        } catch { status = error.localizedDescription }
    }

    func disconnect() {
        KeychainStore.remove()
        token = ""
        status = "ลบ pairing token จากเครื่องแล้ว"
    }

    func authorize() async {
        isBusy = true
        defer { isBusy = false }
        do {
            try await health.requestAuthorization()
            isAuthorized = true
            status = "อนุญาต Apple Health แล้ว"
            try await health.enableBackgroundUpdates { [weak self] in await self?.sync(days: 3, background: true) }
        } catch { status = error.localizedDescription }
    }

    func resumeBackgroundUpdates() async {
        guard !token.isEmpty else { return }
        do {
            try await health.enableBackgroundUpdates { [weak self] in await self?.sync(days: 3, background: true) }
            isAuthorized = true
        } catch {
            // The user can explicitly request Health access from the main screen.
        }
    }

    func sync(days: Int = 14, background _: Bool = false) async {
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            let healthDays = try await health.fetch(days: days)
            guard !healthDays.isEmpty else { status = "ยังไม่พบข้อมูล Apple Health ในช่วงนี้"; return }
            let payload = HealthSyncPayload(
                profileId: profileId,
                capturedAt: ISO8601DateFormatter().string(from: Date()),
                timezone: TimeZone.current.identifier,
                days: healthDays
            )
            let response = try await client.upload(payload: payload, endpoint: endpoint, token: KeychainStore.load())
            lastDays = response.daysReceived
            lastWorkouts = response.workoutsReceived
            lastSyncedAt = Date()
            defaults.set(lastSyncedAt, forKey: "lastSyncedAt")
            status = "ซิงก์ \(response.daysReceived) วัน และ \(response.workoutsReceived) workouts แล้ว"
        } catch { status = error.localizedDescription }
    }
}
