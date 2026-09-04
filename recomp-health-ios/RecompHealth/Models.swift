import Foundation

struct HealthSyncPayload: Codable {
    let profileId: String
    let capturedAt: String
    let timezone: String
    let days: [HealthDayPayload]
}

struct HealthDayPayload: Codable, Identifiable {
    var id: String { date }
    let date: String
    var steps: Double?
    var sleepMinutes: Double?
    var weightKg: Double?
    var bodyFatPercent: Double?
    var leanBodyMassKg: Double?
    var activeEnergyKcal: Double?
    var exerciseMinutes: Double?
    var restingHeartRate: Double?
    var workouts: [HealthWorkoutPayload]

    var hasData: Bool {
        steps != nil || sleepMinutes != nil || weightKg != nil || bodyFatPercent != nil ||
        leanBodyMassKg != nil || activeEnergyKcal != nil || exerciseMinutes != nil ||
        restingHeartRate != nil || !workouts.isEmpty
    }
}

struct HealthWorkoutPayload: Codable, Identifiable {
    let id: String
    let activityType: String
    let startAt: String
    let endAt: String
    let durationMinutes: Double
    let energyKcal: Double?
    let distanceKm: Double?
}

struct HealthSyncResponse: Codable {
    let ok: Bool
    let profileId: String
    let daysReceived: Int
    let logsProcessed: Int
    let workoutsReceived: Int
    let syncedAt: String
}
