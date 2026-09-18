import Foundation
import Combine
import UserNotifications

@MainActor
final class RecompStore: ObservableObject {
    @Published var profileId: String
    @Published var endpoint: String
    @Published var token: String
    @Published private(set) var logs: [DayLog] = []
    @Published private(set) var peerLogs: [DayLog] = []
    @Published private(set) var peerProfileId: String?
    @Published private(set) var workouts: [WorkoutSession] = []
    @Published private(set) var healthWorkouts: [HealthWorkoutPayload] = []
    @Published private(set) var plan = NativePlan()
    @Published private(set) var integration = NativeIntegration()
    @Published private(set) var preferences = NativePreferences()
    @Published var status = "พร้อมเชื่อมต่อ"
    @Published var connectionError: String?
    @Published var isBusy = false
    @Published var isAnalyzing = false
    @Published var healthAuthorized = false

    private let health = HealthKitManager()
    private let defaults = UserDefaults.standard
    private let defaultEndpoint = "https://asia-southeast1-he-served.cloudfunctions.net/recompNative"

    init() {
        profileId = UserDefaults.standard.string(forKey: "nativeProfileId") ?? "zackdark"
        endpoint = UserDefaults.standard.string(forKey: "nativeEndpoint") ?? defaultEndpoint
        token = NativeKeychain.load()
    }

    var profile: NativeProfile { .forID(profileId) }
    var connected: Bool { !token.isEmpty && NativeKeychain.load() == token }
    var todayKey: String { Self.dateKey(Date()) }
    var today: DayLog? { logs.first { $0.date == todayKey } }
    var calorieTarget: Double { plan.calorieTarget ?? profile.calorieTarget }

    static func dateKey(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = TimeZone(identifier: "Asia/Bangkok")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    func saveConnection() async {
        let trimmedEndpoint = endpoint.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedToken = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmedEndpoint), url.scheme == "https", url.host != nil,
              trimmedToken.count >= 32, ["zackdark", "tony"].contains(profileId) else {
            status = NativeError.invalidConnection.localizedDescription
            connectionError = status
            return
        }
        isBusy = true
        defer { isBusy = false }
        do {
            endpoint = trimmedEndpoint
            token = trimmedToken
            try await loadSnapshot()
            try NativeKeychain.save(trimmedToken)
            defaults.set(profileId, forKey: "nativeProfileId")
            defaults.set(endpoint, forKey: "nativeEndpoint")
            connectionError = nil
            status = "เชื่อมต่อและโหลดข้อมูลแล้ว"
        } catch {
            connectionError = error.localizedDescription
            status = connectionError ?? "เชื่อมต่อไม่สำเร็จ"
        }
    }

    func disconnect() {
        NativeKeychain.remove()
        token = ""
        logs = []
        peerLogs = []
        peerProfileId = nil
        workouts = []
        healthWorkouts = []
        plan = NativePlan()
        integration = NativeIntegration()
        preferences = NativePreferences()
        connectionError = nil
        status = "ลบ token จากเครื่องแล้ว"
    }

    func refresh() async {
        guard connected, !isBusy else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            try await loadSnapshot()
            status = "อัปเดตข้อมูลล่าสุดแล้ว"
        } catch { status = error.localizedDescription }
    }

    private func loadSnapshot() async throws {
        let data = try await request(method: "GET", body: nil)
        let snapshot = try JSONDecoder().decode(NativeSnapshot.self, from: data)
        guard snapshot.profileId == profileId else { throw NativeError.invalidResponse }
        logs = snapshot.logs.values.sorted { $0.date < $1.date }
        peerLogs = (snapshot.peerLogs ?? [:]).values.sorted { $0.date < $1.date }
        peerProfileId = snapshot.peerProfileId
        workouts = (snapshot.workouts ?? [:]).values.sorted { $0.date < $1.date }
        healthWorkouts = (snapshot.healthWorkouts ?? [:]).values.sorted { $0.startAt < $1.startAt }
        plan = snapshot.plan
        integration = snapshot.appleHealth
        preferences = snapshot.preferences ?? NativePreferences()
    }

    func save(date: String, fields: [String: Any]) async -> Bool {
        guard connected, !isBusy else { return false }
        isBusy = true
        defer { isBusy = false }
        do {
            _ = try await request(method: "POST", body: ["profileId": profileId, "date": date, "fields": fields])
            try await loadSnapshot()
            status = "บันทึก \(date) แล้ว"
            return true
        } catch {
            status = error.localizedDescription
            return false
        }
    }

    func estimateFood(description: String? = nil, imageJPEG: Data? = nil) async throws -> FoodEstimate {
        guard connected else { throw NativeError.invalidConnection }
        guard !isAnalyzing else { throw NativeError.server("กำลังประเมินรายการก่อนหน้า") }
        isAnalyzing = true
        defer { isAnalyzing = false }
        var body: [String: Any] = ["action": "estimateFood", "profileId": profileId]
        if let description { body["description"] = description }
        else if let imageJPEG {
            guard imageJPEG.count <= 5 * 1024 * 1024 else { throw NativeError.server("รูปใหญ่เกินไป กรุณาครอปแล้วลองใหม่") }
            body["imageBase64"] = imageJPEG.base64EncodedString()
            body["mimeType"] = "image/jpeg"
        } else { throw NativeError.server("เลือกรูปหรือพิมพ์อาหารก่อน") }
        let data = try await request(method: "POST", body: body, timeout: 80)
        return try JSONDecoder().decode(FoodEstimate.self, from: data)
    }

    func parseDailyText(_ description: String) async throws -> DailyEstimate {
        guard connected else { throw NativeError.invalidConnection }
        guard !isAnalyzing else { throw NativeError.server("กำลังประเมินรายการก่อนหน้า") }
        isAnalyzing = true
        defer { isAnalyzing = false }
        let data = try await request(method: "POST", body: [
            "action": "parseDailyText", "profileId": profileId, "description": description,
        ], timeout: 80)
        return try JSONDecoder().decode(DailyEstimate.self, from: data)
    }

    func addFoods(date: String, meal: String, foods: [FoodDraft]) async -> Bool {
        do {
            let foodData = try JSONEncoder().encode(foods)
            let values = try JSONSerialization.jsonObject(with: foodData)
            return await mutate(["action": "addFoods", "profileId": profileId,
                                 "date": date, "meal": meal, "foods": values], success: "บันทึกอาหารแล้ว")
        } catch { status = error.localizedDescription; return false }
    }

    func confirmDaily(date: String, draft: DailyEstimate) async -> Bool {
        do {
            let data = try JSONEncoder().encode(draft)
            var object = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
            object["action"] = "confirmDaily"
            object["profileId"] = profileId
            object["date"] = date
            return await mutate(object, success: "บันทึกทั้งวันแล้ว")
        } catch { status = error.localizedDescription; return false }
    }

    func saveWorkout(_ workout: WorkoutSession) async -> Bool {
        do {
            let data = try JSONEncoder().encode(workout)
            let object = try JSONSerialization.jsonObject(with: data)
            return await mutate(["action": "saveWorkout", "profileId": profileId,
                                 "workout": object], success: "บันทึกเวิร์กเอาต์แล้ว")
        } catch { status = error.localizedDescription; return false }
    }

    func updatePlan(_ calorieTarget: Double) async -> Bool {
        await mutate(["action": "updatePlan", "profileId": profileId,
                      "calorieTarget": calorieTarget], success: "ปรับเป้าหมายแล้ว")
    }

    func updatePreferences(_ next: NativePreferences) async -> Bool {
        do {
            let data = try JSONEncoder().encode(next)
            let object = try JSONSerialization.jsonObject(with: data)
            let saved = await mutate(["action": "updatePreferences", "profileId": profileId,
                                      "preferences": object], success: "บันทึกการตั้งค่าแล้ว")
            if saved { await scheduleReminders() }
            return saved
        } catch { status = error.localizedDescription; return false }
    }

    private func scheduleReminders() async {
        let center = UNUserNotificationCenter.current()
        let identifiers = ["recomp-morningWeighIn", "recomp-proteinReminder", "recomp-weeklyReview"]
            + (0...6).map { "recomp-workoutReminder-\($0)" }
        center.removePendingNotificationRequests(withIdentifiers: identifiers)
        let settings: [(String, Bool, String, String, String, Int?)] = [
            ("morningWeighIn", preferences.morningWeighIn == true, "08:00", "บันทึกน้ำหนัก", "ชั่งน้ำหนักตอนเช้าแล้วบันทึกใน Recomp", nil),
            ("proteinReminder", preferences.proteinReminder == true, "12:00", "เช็กโปรตีนวันนี้", "บันทึกมื้ออาหารและดูโปรตีนที่ทานไป", nil),
            ("workoutReminder", preferences.workoutReminder == true, "18:00", "ถึงเวลาขยับตัว", "บันทึกการออกกำลังกายเมื่อเสร็จแล้ว", nil),
            ("weeklyReview", preferences.weeklyReview == true, "19:00", "สรุปสัปดาห์", "เปิดดูความคืบหน้าใน Recomp", 1),
        ]
        guard settings.contains(where: { $0.1 }) else { return }
        do {
            guard try await center.requestAuthorization(options: [.alert, .sound]) else {
                status = "เปิดการแจ้งเตือนใน Settings เพื่อรับการเตือน"
                return
            }
            for (key, enabled, fallback, title, body, weekday) in settings where enabled {
                let time = preferences.reminderTimes?[key] ?? fallback
                let parts = time.split(separator: ":").compactMap { Int($0) }
                guard parts.count == 2 else { continue }
                let days: [Int?] = key == "workoutReminder"
                    ? (preferences.workoutDays ?? [1, 3, 6]).map { Optional($0 + 1) }
                    : [weekday]
                for day in days {
                    var components = DateComponents()
                    components.hour = parts[0]
                    components.minute = parts[1]
                    components.weekday = day
                    let content = UNMutableNotificationContent()
                    content.title = title
                    content.body = body
                    content.sound = .default
                    let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: true)
                    let identifier = "recomp-\(key)" + (key == "workoutReminder" ? "-\((day ?? 1) - 1)" : "")
                    try await center.add(UNNotificationRequest(identifier: identifier, content: content, trigger: trigger))
                }
            }
        } catch { status = "บันทึกการตั้งค่าแล้ว แต่ตั้งการแจ้งเตือนไม่สำเร็จ: \(error.localizedDescription)" }
    }

    func exportSnapshot() async throws -> URL {
        guard connected else { throw NativeError.invalidConnection }
        let data = try await request(method: "GET", body: nil, exportAll: true)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("recomp-\(profileId)-backup.json")
        try data.write(to: url, options: .atomic)
        return url
    }

    private func mutate(_ body: [String: Any], success: String) async -> Bool {
        guard connected, !isBusy else { return false }
        isBusy = true
        defer { isBusy = false }
        do {
            _ = try await request(method: "POST", body: body)
            try await loadSnapshot()
            status = success
            return true
        } catch { status = error.localizedDescription; return false }
    }

    func authorizeHealth() async {
        do {
            try await health.requestAuthorization()
            healthAuthorized = true
            status = "เชื่อม Apple Health แล้ว"
            try await health.enableBackgroundUpdates { [weak self] in await self?.syncHealth(days: 3) }
        } catch { status = error.localizedDescription }
    }

    func resumeHealth() async {
        guard connected else { return }
        try? await health.enableBackgroundUpdates { [weak self] in await self?.syncHealth(days: 3) }
    }

    func syncHealth(days: Int = 14) async {
        guard connected, !isBusy else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            let healthDays = try await health.fetch(days: days)
            guard !healthDays.isEmpty else { status = "ยังไม่มีข้อมูล Apple Health"; return }
            let payload = HealthSyncPayload(
                profileId: profileId,
                capturedAt: ISO8601DateFormatter().string(from: Date()),
                timezone: TimeZone.current.identifier,
                days: healthDays
            )
            let payloadData = try JSONEncoder().encode(payload)
            let payloadObject = try JSONSerialization.jsonObject(with: payloadData)
            _ = try await request(method: "POST", body: ["action": "syncHealth", "profileId": profileId, "payload": payloadObject])
            try await loadSnapshot()
            status = "ซิงก์ Apple Health \(healthDays.count) วันแล้ว"
        } catch { status = error.localizedDescription }
    }

    private func request(method: String, body: [String: Any]?, timeout: TimeInterval = 30, exportAll: Bool = false) async throws -> Data {
        guard let base = URL(string: endpoint), base.scheme == "https", token.count >= 32 else { throw NativeError.invalidConnection }
        var components = URLComponents(url: base, resolvingAgainstBaseURL: false)
        if method == "GET" {
            components?.queryItems = [URLQueryItem(name: "profileId", value: profileId)]
            if exportAll { components?.queryItems?.append(URLQueryItem(name: "export", value: "1")) }
        }
        guard let url = components?.url else { throw NativeError.invalidConnection }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = timeout
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw NativeError.invalidResponse }
        guard (200..<300).contains(response.statusCode) else {
            let server = (try? JSONSerialization.jsonObject(with: data) as? [String: String])?["error"] ?? "HTTP \(response.statusCode)"
            throw NativeError.server(server)
        }
        return data
    }
}
