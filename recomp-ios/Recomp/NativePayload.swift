import Foundation

struct DayLog: Decodable, Identifiable {
    var id: String { date }
    let date: String
    var calories: Double?
    var protein: Double?
    var carbs: Double?
    var fat: Double?
    var fiber: Double?
    var produceServings: Double?
    var water: Double?
    var weight: Double?
    var steps: Double?
    var sleep: Double?
    var exerciseMinutes: Double?
    var zone2Minutes: Double?
    var exerciseDescription: String?
    var activeEnergy: Double?
    var restingHeartRate: Double?
    var bodyFat: Double?
    var muscle: Double?
    var waist: Double?
    var visceral: Double?
    var mood: String?
    var hunger: Double?
    var energy: Double?
    var workout: Bool?
    var restDay: Bool?
    var sickDay: Bool?
    var vacationMode: Bool?
    var notes: String?
    var meals: [String: MealLog]?
    var sources: [String: String]?

    enum CodingKeys: String, CodingKey {
        case date, calories, protein, carbs, fat, fiber, produceServings, water, weight, steps,
             sleep, exerciseMinutes, zone2Minutes, exerciseDescription, activeEnergy,
             restingHeartRate, bodyFat, muscle, waist, visceral, mood, hunger, energy,
             workout, restDay, sickDay, vacationMode, notes, meals, sources
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        date = try values.decode(String.self, forKey: .date)
        func metric(_ key: CodingKeys) -> Double? {
            if let value = try? values.decode(Double.self, forKey: key) { return value }
            if let text = try? values.decode(String.self, forKey: key) { return Double(text) }
            return nil
        }
        calories = metric(.calories); protein = metric(.protein); carbs = metric(.carbs)
        fat = metric(.fat); fiber = metric(.fiber); produceServings = metric(.produceServings)
        water = metric(.water); weight = metric(.weight); steps = metric(.steps)
        sleep = metric(.sleep); exerciseMinutes = metric(.exerciseMinutes)
        zone2Minutes = metric(.zone2Minutes); activeEnergy = metric(.activeEnergy)
        restingHeartRate = metric(.restingHeartRate); bodyFat = metric(.bodyFat)
        muscle = metric(.muscle); waist = metric(.waist); visceral = metric(.visceral)
        hunger = metric(.hunger); energy = metric(.energy)
        exerciseDescription = try? values.decode(String.self, forKey: .exerciseDescription)
        mood = try? values.decode(String.self, forKey: .mood)
        notes = try? values.decode(String.self, forKey: .notes)
        workout = try? values.decode(Bool.self, forKey: .workout)
        restDay = try? values.decode(Bool.self, forKey: .restDay)
        sickDay = try? values.decode(Bool.self, forKey: .sickDay)
        vacationMode = try? values.decode(Bool.self, forKey: .vacationMode)
        meals = try? values.decode([String: MealLog].self, forKey: .meals)
        sources = try? values.decode([String: String].self, forKey: .sources)
    }
}

struct MealLog: Decodable {
    var calories: Double?
    var protein: Double?
    var carbs: Double?
    var fat: Double?
    var fiber: Double?
    var produceServings: Double?
    var items: [MealItem] = []

    enum CodingKeys: String, CodingKey {
        case calories, protein, carbs, fat, fiber, produceServings, items
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        calories = try? values.decode(Double.self, forKey: .calories)
        protein = try? values.decode(Double.self, forKey: .protein)
        carbs = try? values.decode(Double.self, forKey: .carbs)
        fat = try? values.decode(Double.self, forKey: .fat)
        fiber = try? values.decode(Double.self, forKey: .fiber)
        produceServings = try? values.decode(Double.self, forKey: .produceServings)
        items = (try? values.decode([MealItem].self, forKey: .items)) ?? []
    }
}

struct MealItem: Decodable, Identifiable {
    var entryId: String?
    var name: String
    var serving: String?
    var calories: Double?
    var protein: Double?
    var id: String { entryId ?? "\(name)-\(calories ?? 0)" }

    enum CodingKeys: String, CodingKey { case entryId, name, serving, calories, protein }

    init(from decoder: Decoder) throws {
        if let value = try? decoder.singleValueContainer().decode(String.self) {
            name = value
            return
        }
        let values = try decoder.container(keyedBy: CodingKeys.self)
        entryId = try? values.decode(String.self, forKey: .entryId)
        name = (try? values.decode(String.self, forKey: .name)) ?? "อาหาร"
        serving = try? values.decode(String.self, forKey: .serving)
        calories = try? values.decode(Double.self, forKey: .calories)
        protein = try? values.decode(Double.self, forKey: .protein)
    }
}

struct FoodDraft: Codable {
    var name: String = ""
    var serving: String = "1 ส่วน"
    var calories: Double = 0
    var protein: Double = 0
    var carbs: Double = 0
    var fat: Double = 0
    var fiber: Double = 0
    var produceServings: Double = 0
    var meal: String? = nil
    var source: String? = nil
}

struct FoodEstimate: Decodable {
    var isFood: Bool
    var confidence: String
    var assumptions: String
    var foods: [FoodDraft]
}

struct DailyEstimate: Codable {
    var foods: [FoodDraft]
    var waterMentioned: Bool
    var waterLiters: Double
    var exerciseMentioned: Bool
    var exerciseDescription: String
    var exerciseMinutes: Double
    var zone2Minutes: Double
    var stepsMentioned: Bool
    var steps: Double
    var workoutDone: Bool
    var assumptions: String
}

struct WorkoutSet: Codable {
    var weight: Double? = nil
    var reps: Double? = nil
}

struct WorkoutExercise: Codable {
    var name: String
    var scheme: String = ""
    var done: Bool = false
    var rir: Double? = nil
    var sets: [WorkoutSet] = []
}

struct WorkoutSession: Codable, Identifiable {
    var id: String { "\(date)-\(type)" }
    var date: String
    var type: String
    var durationMinutes: Double? = nil
    var exercises: [WorkoutExercise] = []
    var completedExercises: Int? = nil
}

struct NativePreferences: Codable {
    var morningWeighIn: Bool? = nil
    var proteinReminder: Bool? = nil
    var workoutReminder: Bool? = nil
    var weeklyReview: Bool? = nil
    var workoutDays: [Int]? = nil
    var reminderTimes: [String: String]? = nil
}

struct NativeSnapshot: Decodable {
    let profileId: String
    let logs: [String: DayLog]
    let plan: NativePlan
    let appleHealth: NativeIntegration
    let workouts: [String: WorkoutSession]?
    let healthWorkouts: [String: HealthWorkoutPayload]?
    let preferences: NativePreferences?
    let peerProfileId: String?
    let peerLogs: [String: DayLog]?
}

struct NativePlan: Decodable {
    var calorieTarget: Double?
}

struct NativeIntegration: Decodable {
    var paired: Bool?
    var lastSyncedAt: String?
}

struct NativeProfile {
    let id: String
    let name: String
    let calorieTarget: Double
    let proteinTarget: Double
    let waterTarget: Double
    let stepsTarget: Double

    static func forID(_ id: String) -> NativeProfile {
        id == "tony"
            ? NativeProfile(id: "tony", name: "Tony", calorieTarget: 2100, proteinTarget: 135, waterTarget: 3.5, stepsTarget: 9000)
            : NativeProfile(id: "zackdark", name: "Zackdark", calorieTarget: 2000, proteinTarget: 125, waterTarget: 3, stepsTarget: 9000)
    }
}
