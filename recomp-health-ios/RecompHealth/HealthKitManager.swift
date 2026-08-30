import Foundation
import HealthKit

final class HealthKitManager {
    private let store = HKHealthStore()
    private var observerQueries: [HKObserverQuery] = []
    private var calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Bangkok") ?? .current
        return calendar
    }()

    private var quantityTypes: [HKQuantityTypeIdentifier: HKQuantityType] {
        Dictionary(uniqueKeysWithValues: [
            .stepCount, .bodyMass, .bodyFatPercentage, .leanBodyMass, .activeEnergyBurned,
        ].compactMap { identifier in
            HKObjectType.quantityType(forIdentifier: identifier).map { (identifier, $0) }
        })
    }

    private var sleepType: HKCategoryType? { HKObjectType.categoryType(forIdentifier: .sleepAnalysis) }
    private var workoutType: HKWorkoutType { HKObjectType.workoutType() }

    func requestAuthorization() async throws {
        guard HKHealthStore.isHealthDataAvailable() else { throw HealthError.unavailable }
        var readTypes = Set<HKObjectType>(quantityTypes.values)
        if let sleepType { readTypes.insert(sleepType) }
        readTypes.insert(workoutType)
        try await store.requestAuthorization(toShare: [], read: readTypes)
    }

    func fetch(days lookback: Int) async throws -> [HealthDayPayload] {
        let safeLookback = min(31, max(1, lookback))
        let today = calendar.startOfDay(for: Date())
        guard let start = calendar.date(byAdding: .day, value: -(safeLookback - 1), to: today),
              let end = calendar.date(byAdding: .day, value: 1, to: today) else { return [] }
        let dates = (0..<safeLookback).compactMap { calendar.date(byAdding: .day, value: $0, to: start) }
        var days = Dictionary(uniqueKeysWithValues: dates.map { date in
            let key = Self.dateKey(date)
            return (key, HealthDayPayload(date: key, workouts: []))
        })

        async let steps = dailySums(identifier: .stepCount, unit: .count(), start: start, end: end)
        async let energy = dailySums(identifier: .activeEnergyBurned, unit: .kilocalorie(), start: start, end: end)
        async let weights = dailyLatest(identifier: .bodyMass, unit: .gramUnit(with: .kilo), start: start, end: end)
        async let bodyFatFractions = dailyLatest(identifier: .bodyFatPercentage, unit: .percent(), start: start, end: end)
        async let leanMass = dailyLatest(identifier: .leanBodyMass, unit: .gramUnit(with: .kilo), start: start, end: end)
        async let sleep = dailySleep(start: start, end: end)
        async let workouts = workoutSamples(start: start, end: end)

        for (date, value) in try await steps { days[date]?.steps = value }
        for (date, value) in try await energy { days[date]?.activeEnergyKcal = value }
        for (date, value) in try await weights { days[date]?.weightKg = value }
        for (date, value) in try await bodyFatFractions { days[date]?.bodyFatPercent = value * 100 }
        for (date, value) in try await leanMass { days[date]?.leanBodyMassKg = value }
        for (date, value) in try await sleep { days[date]?.sleepMinutes = value }
        for workout in try await workouts {
            let date = Self.dateKey(ISO8601DateFormatter().date(from: workout.startAt) ?? today)
            days[date]?.workouts.append(workout)
        }
        return dates.compactMap { days[Self.dateKey($0)] }.filter(\.hasData)
    }

    func enableBackgroundUpdates(onChange: @escaping @Sendable () async -> Void) async throws {
        observerQueries.forEach { store.stop($0) }
        observerQueries.removeAll()
        var sampleTypes = quantityTypes.values.map { $0 as HKSampleType }
        if let sleepType { sampleTypes.append(sleepType) }
        sampleTypes.append(workoutType)
        for type in sampleTypes {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                store.enableBackgroundDelivery(for: type, frequency: .hourly) { success, error in
                    if let error { continuation.resume(throwing: error) }
                    else if success { continuation.resume() }
                    else { continuation.resume(throwing: HealthError.backgroundDeliveryFailed) }
                }
            }
            let query = HKObserverQuery(sampleType: type, predicate: nil) { _, completion, error in
                guard error == nil else { completion(); return }
                Task {
                    await onChange()
                    completion()
                }
            }
            observerQueries.append(query)
            store.execute(query)
        }
    }

    private func dailySums(identifier: HKQuantityTypeIdentifier, unit: HKUnit, start: Date, end: Date) async throws -> [String: Double] {
        guard let type = quantityTypes[identifier] else { return [:] }
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
        return try await withCheckedThrowingContinuation { continuation in
            var components = DateComponents(); components.day = 1
            let query = HKStatisticsCollectionQuery(quantityType: type, quantitySamplePredicate: predicate, options: .cumulativeSum, anchorDate: start, intervalComponents: components)
            query.initialResultsHandler = { [calendar] _, results, error in
                if let error { continuation.resume(throwing: error); return }
                var output: [String: Double] = [:]
                results?.enumerateStatistics(from: start, to: end) { statistics, _ in
                    guard let value = statistics.sumQuantity()?.doubleValue(for: unit) else { return }
                    output[Self.dateKey(calendar.startOfDay(for: statistics.startDate))] = value
                }
                continuation.resume(returning: output)
            }
            self.store.execute(query)
        }
    }

    private func dailyLatest(identifier: HKQuantityTypeIdentifier, unit: HKUnit, start: Date, end: Date) async throws -> [String: Double] {
        guard let type = quantityTypes[identifier] else { return [:] }
        let samples = try await quantitySamples(type: type, start: start, end: end)
        var latest: [String: HKQuantitySample] = [:]
        for sample in samples {
            let key = Self.dateKey(sample.endDate)
            if latest[key] == nil || sample.endDate > latest[key]!.endDate { latest[key] = sample }
        }
        return latest.mapValues { $0.quantity.doubleValue(for: unit) }
    }

    private func quantitySamples(type: HKQuantityType, start: Date, end: Date) async throws -> [HKQuantitySample] {
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
        return try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(sampleType: type, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, error in
                if let error { continuation.resume(throwing: error); return }
                continuation.resume(returning: (samples as? [HKQuantitySample]) ?? [])
            }
            store.execute(query)
        }
    }

    private func dailySleep(start: Date, end: Date) async throws -> [String: Double] {
        guard let sleepType else { return [:] }
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: [])
        let samples: [HKCategorySample] = try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(sampleType: sleepType, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, error in
                if let error { continuation.resume(throwing: error); return }
                continuation.resume(returning: (samples as? [HKCategorySample]) ?? [])
            }
            store.execute(query)
        }
        let asleepValues: Set<Int> = [
            HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue,
            HKCategoryValueSleepAnalysis.asleepCore.rawValue,
            HKCategoryValueSleepAnalysis.asleepDeep.rawValue,
            HKCategoryValueSleepAnalysis.asleepREM.rawValue,
        ]
        var intervals: [String: [(Date, Date)]] = [:]
        for sample in samples where asleepValues.contains(sample.value) {
            var cursor = max(sample.startDate, start)
            let sampleEnd = min(sample.endDate, end)
            while cursor < sampleEnd {
                let day = calendar.startOfDay(for: cursor)
                let nextDay = calendar.date(byAdding: .day, value: 1, to: day) ?? sampleEnd
                let sliceEnd = min(sampleEnd, nextDay)
                intervals[Self.dateKey(day), default: []].append((cursor, sliceEnd))
                cursor = sliceEnd
            }
        }
        return intervals.mapValues(Self.unionMinutes)
    }

    private func workoutSamples(start: Date, end: Date) async throws -> [HealthWorkoutPayload] {
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
        let workouts: [HKWorkout] = try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(sampleType: workoutType, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, error in
                if let error { continuation.resume(throwing: error); return }
                continuation.resume(returning: (samples as? [HKWorkout]) ?? [])
            }
            store.execute(query)
        }
        let activeEnergy = quantityTypes[.activeEnergyBurned]
        let distance = HKObjectType.quantityType(forIdentifier: .distanceWalkingRunning)
        return workouts.map { workout in
            let energy = activeEnergy.flatMap { workout.statistics(for: $0)?.sumQuantity()?.doubleValue(for: .kilocalorie()) }
            let distanceKm = distance.flatMap { workout.statistics(for: $0)?.sumQuantity()?.doubleValue(for: .meterUnit(with: .kilo)) }
            return HealthWorkoutPayload(
                id: workout.uuid.uuidString,
                activityType: Self.activityName(workout.workoutActivityType),
                startAt: ISO8601DateFormatter().string(from: workout.startDate),
                endAt: ISO8601DateFormatter().string(from: workout.endDate),
                durationMinutes: workout.duration / 60,
                energyKcal: energy,
                distanceKm: distanceKm
            )
        }
    }

    private static func unionMinutes(_ intervals: [(Date, Date)]) -> Double {
        let sorted = intervals.sorted { $0.0 < $1.0 }
        guard var current = sorted.first else { return 0 }
        var seconds: TimeInterval = 0
        for interval in sorted.dropFirst() {
            if interval.0 <= current.1 { current.1 = max(current.1, interval.1) }
            else { seconds += current.1.timeIntervalSince(current.0); current = interval }
        }
        seconds += current.1.timeIntervalSince(current.0)
        return seconds / 60
    }

    private static func activityName(_ type: HKWorkoutActivityType) -> String {
        switch type {
        case .traditionalStrengthTraining: "traditionalStrengthTraining"
        case .functionalStrengthTraining: "functionalStrengthTraining"
        case .walking: "walking"
        case .running: "running"
        case .cycling: "cycling"
        case .highIntensityIntervalTraining: "highIntensityIntervalTraining"
        case .yoga: "yoga"
        case .swimming: "swimming"
        default: "activity-\(type.rawValue)"
        }
    }

    private static func dateKey(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = TimeZone(identifier: "Asia/Bangkok")
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    enum HealthError: LocalizedError {
        case unavailable
        case backgroundDeliveryFailed
        var errorDescription: String? {
            switch self {
            case .unavailable: "อุปกรณ์นี้ไม่รองรับ Apple Health"
            case .backgroundDeliveryFailed: "เปิด background sync ของ Apple Health ไม่สำเร็จ"
            }
        }
    }
}
