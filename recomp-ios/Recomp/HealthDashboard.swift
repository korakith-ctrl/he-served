import SwiftUI
import Charts

private enum HealthLook {
    static let activity = RecompTheme.activity
    static let nutrition = RecompTheme.food
    static let sleep = RecompTheme.brand
    static let neutral = RecompTheme.canvas
}

private func healthNumber(_ value: Double?, digits: Int = 0) -> String {
    FormatUtils.number(value, digits: digits)
}

private func healthSleep(_ minutes: Double?) -> String {
    FormatUtils.sleepDuration(minutes)
}

private func healthDate(_ key: String) -> String {
    FormatUtils.thaiDate(key)
}

@MainActor private func periodLogs(_ logs: [DayLog], days: Int, offset: Int = 0) -> [DayLog] {
    let calendar = Calendar.current
    let end = calendar.date(byAdding: .day, value: -offset, to: Date()) ?? Date()
    let start = calendar.date(byAdding: .day, value: -(days - 1), to: end) ?? end
    let startKey = RecompStore.dateKey(start)
    let endKey = RecompStore.dateKey(end)
    return logs.filter { $0.date >= startKey && $0.date <= endKey }
}

private struct CategoryCard: View {
    let title: String
    let symbol: String
    let value: String
    let unit: String
    let detail: String
    let color: Color
    let progress: Double?
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let isDark = colorScheme == .dark
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Label(title, systemImage: symbol)
                    .font(.headline)
                    .foregroundStyle(isDark ? color : .white)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(isDark ? RecompTheme.secondary : .white.opacity(0.8))
            }
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                        Text(value)
                            .font(.system(size: 34, weight: .bold, design: .rounded))
                            .contentTransition(.numericText())
                            .foregroundStyle(isDark ? RecompTheme.ink : .white)
                        Text(unit)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(isDark ? RecompTheme.secondary : .white.opacity(0.9))
                    }
                    Text(detail)
                        .font(.caption)
                        .lineLimit(2)
                        .foregroundStyle(isDark ? RecompTheme.secondary : .white.opacity(0.9))
                }
                Spacer(minLength: 0)
                ZStack {
                    Circle()
                        .stroke(isDark ? color.opacity(0.2) : .white.opacity(0.22), lineWidth: 8)
                    if let progress {
                        Circle()
                            .trim(from: 0, to: min(max(progress, 0), 1))
                            .stroke(isDark ? color : .white, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                            .rotationEffect(.degrees(-90))
                    }
                    Image(systemName: symbol)
                        .font(.title2.weight(.medium))
                        .foregroundStyle(isDark ? color : .white)
                }
                .frame(width: 77, height: 77)
                .accessibilityHidden(true)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(minHeight: 145)
        .background(
            Group {
                if isDark {
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .fill(RecompTheme.surface)
                        .overlay(
                            RoundedRectangle(cornerRadius: 20, style: .continuous)
                                .stroke(color.opacity(0.28), lineWidth: 1)
                        )
                } else {
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .fill(LinearGradient(colors: [color, color.opacity(0.82)], startPoint: .topLeading, endPoint: .bottomTrailing))
                }
            }
        )
        .accessibilityElement(children: .combine)
    }
}

private struct MetricLine: View {
    let symbol: String
    let label: String
    let value: String
    let tint: Color

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: symbol).font(.subheadline.weight(.semibold))
                .foregroundStyle(tint).frame(width: 30)
            Text(label).foregroundStyle(RecompTheme.ink)
            Spacer()
            Text(value).font(.subheadline.weight(.semibold)).foregroundStyle(RecompTheme.ink)
            Image(systemName: "chevron.right").font(.caption.weight(.semibold))
                .foregroundStyle(RecompTheme.secondary)
        }
        .padding(.vertical, 8)
        .contentShape(Rectangle())
    }
}

private struct SectionHeading: View {
    let title: String
    var body: some View {
        Text(title).font(.title3.weight(.bold)).foregroundStyle(RecompTheme.ink)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct TodayView: View {
    @Binding var selectedTab: Int
    @EnvironmentObject private var store: RecompStore
    @State private var showSearch = false
    @State private var showFood = false

    private var log: DayLog? { store.today }
    private var recent: [DayLog] { periodLogs(store.logs, days: 7) }
    private var stepAverage: Double? {
        let values = recent.compactMap(\.steps)
        return values.isEmpty ? nil : values.reduce(0, +) / Double(values.count)
    }
    private var nextStep: String {
        if log?.calories == nil { return "เริ่มจากบันทึกมื้อแรกของวัน" }
        if (log?.protein ?? 0) < store.profile.proteinTarget { return "มื้อถัดไป ลองเพิ่มแหล่งโปรตีนให้ถึงเป้า" }
        if log?.steps == nil { return "ซิงก์ Apple Health เพื่อดูการเคลื่อนไหว" }
        return "วันนี้มีข้อมูลการกินและกิจกรรมครบถ้วนแล้ว"
    }
    private let meals = [("breakfast", "มื้อเช้า"), ("lunch", "มื้อกลางวัน"), ("dinner", "มื้อเย็น"), ("snacks", "ของว่าง")]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    header
                    if !store.connected { connectionHint }
                    if store.connected {
                        Surface {
                            Label("สิ่งที่ควรทำต่อ", systemImage: "sparkles")
                                .font(.caption.weight(.bold))
                                .foregroundStyle(RecompTheme.brand)
                            Text(nextStep)
                                .font(.headline)
                                .foregroundStyle(RecompTheme.ink)
                        }
                    }
                    NavigationLink { ActivityDetailView() } label: {
                        CategoryCard(title: "กิจกรรม", symbol: "figure.walk",
                                     value: healthNumber(log?.steps), unit: "ก้าว",
                                     detail: log?.steps == nil ? "ซิงก์ Apple Health เพื่อดูข้อมูล" : "วันนี้ · เดินและเคลื่อนไหว",
                                     color: HealthLook.activity,
                                     progress: log?.steps.map { $0 / store.profile.stepsTarget })
                    }
                    NavigationLink { NutritionDetailView() } label: {
                        CategoryCard(title: "โภชนาการ", symbol: "fork.knife",
                                     value: healthNumber(log?.calories), unit: "kcal",
                                     detail: "โปรตีน \(healthNumber(log?.protein)) g · น้ำ \(healthNumber(log?.water, digits: 1)) L",
                                     color: HealthLook.nutrition,
                                     progress: log?.calories.map { $0 / max(store.calorieTarget, 1) })
                    }
                    NavigationLink { SleepDetailView() } label: {
                        CategoryCard(title: "การนอน", symbol: "moon.zzz.fill",
                                     value: healthSleep(log?.sleep), unit: "",
                                     detail: log?.sleep == nil ? "บันทึกหรือซิงก์ข้อมูลการนอน" : "ข้อมูลที่บันทึกล่าสุด",
                                     color: HealthLook.sleep, progress: nil)
                    }
                    Surface {
                        HStack {
                            Label("มื้ออาหารวันนี้", systemImage: "fork.knife").font(.headline)
                            Spacer()
                            Button { showFood = true } label: {
                                Label("เพิ่มอาหาร", systemImage: "plus")
                                    .font(.caption.weight(.semibold))
                            }
                            .disabled(!store.connected)
                        }
                        ForEach(meals, id: \.0) { key, title in
                            HStack {
                                Text(title).font(.subheadline).foregroundStyle(RecompTheme.ink)
                                Spacer()
                                Text(log?.meals?[key]?.calories.map { "\(healthNumber($0)) kcal" } ?? "—")
                                    .font(.subheadline).foregroundStyle(RecompTheme.secondary)
                            }
                            if key != "snacks" { Divider() }
                        }
                    }
                    SectionHeading(title: "ดูเพิ่มเติม")
                        .padding(.top, 4)
                    Surface {
                        NavigationLink { StepsDetailView() } label: {
                            MetricLine(symbol: "chart.bar.fill", label: "ก้าวเฉลี่ย 7 วัน",
                                       value: stepAverage.map { "\(healthNumber($0)) ก้าว" } ?? "—",
                                       tint: HealthLook.activity)
                        }
                        Divider()
                        NavigationLink { WeightDetailView() } label: {
                            MetricLine(symbol: "scalemass", label: "น้ำหนักล่าสุด",
                                       value: log?.weight.map { "\(healthNumber($0, digits: 1)) กก." }
                                           ?? store.logs.last(where: { $0.weight != nil })?.weight.map { "\(healthNumber($0, digits: 1)) กก." } ?? "—",
                                       tint: RecompTheme.brand)
                        }
                        Divider()
                        Button { showFood = true } label: {
                            MetricLine(symbol: "plus.circle.fill", label: "เพิ่มอาหาร",
                                       value: "ถ่ายรูปหรือพิมพ์", tint: HealthLook.nutrition)
                        }
                        .disabled(!store.connected)
                    }
                    healthFreshness
                }
                .padding(.horizontal, 20)
                .padding(.top, 12)
                .padding(.bottom, 30)
            }
            .background(RecompTheme.canvas.ignoresSafeArea())
            .toolbar(.hidden, for: .navigationBar)
            .animation(.easeInOut(duration: 0.25), value: store.today?.calories)
        }
        .sheet(isPresented: $showSearch) { HealthSearchView() }
        .sheet(isPresented: $showFood) { AIAddFoodSheet(date: store.todayKey) }
    }

    private var header: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 2) {
                Text("สุขภาพ").font(.system(size: 33, weight: .bold, design: .rounded))
                    .foregroundStyle(RecompTheme.ink)
                Text(Date.now.formatted(Date.FormatStyle.dateTime.day().month(.wide).year().locale(Locale(identifier: "th_TH"))))
                    .font(.footnote).foregroundStyle(RecompTheme.secondary)
            }
            Spacer()
            Button { showSearch = true } label: {
                Image(systemName: "magnifyingglass").font(.system(size: 17, weight: .semibold))
                    .frame(width: 39, height: 39)
                    .background(RecompTheme.surface, in: Circle())
            }
            .accessibilityLabel("ค้นหาข้อมูลสุขภาพ")
            Button { selectedTab = 4 } label: {
                Text(store.profile.name.prefix(1).uppercased())
                    .font(.subheadline.weight(.bold)).frame(width: 39, height: 39)
                    .background(RecompTheme.brand.opacity(0.16), in: Circle())
            }
            .accessibilityLabel("เปิดโปรไฟล์")
        }
        .foregroundStyle(RecompTheme.ink)
        .padding(.bottom, 4)
    }

    private var connectionHint: some View {
        Button { selectedTab = 4 } label: {
            HStack {
                Image(systemName: "link.badge.plus")
                Text("เชื่อมบัญชีเพื่อดูข้อมูลและบันทึกอาหาร")
                Spacer()
                Image(systemName: "chevron.right")
            }
            .font(.subheadline.weight(.medium))
            .foregroundStyle(RecompTheme.brand)
            .padding(14)
            .background(RecompTheme.surface, in: RoundedRectangle(cornerRadius: 14))
        }
    }

    private var healthFreshness: some View {
        HStack(spacing: 6) {
            Image(systemName: "heart.text.square")
            if let synced = store.integration.lastSyncedAt {
                Text("Apple Health ซิงก์ล่าสุด \(synced.prefix(16).replacingOccurrences(of: "T", with: " "))")
            } else {
                Text("Apple Health ยังไม่ซิงก์")
            }
            Spacer()
            Button("อัปเดต") { Task { await store.refresh() } }
                .disabled(!store.connected || store.isBusy)
        }
        .font(.caption).foregroundStyle(RecompTheme.secondary)
        .padding(.top, 2)
    }
}

private struct ActivityDetailView: View {
    @EnvironmentObject private var store: RecompStore
    private var log: DayLog? { store.today }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("ข้อมูลกิจกรรมวันนี้").font(.subheadline).foregroundStyle(RecompTheme.secondary)
                NavigationLink { StepsDetailView() } label: {
                    Surface {
                        MetricLine(symbol: "figure.walk", label: "จำนวนก้าว",
                                   value: "\(healthNumber(log?.steps)) ก้าว", tint: HealthLook.activity)
                        if let steps = log?.steps {
                            ProgressView(value: min(steps / store.profile.stepsTarget, 1))
                                .tint(HealthLook.activity)
                            Text("เป้า \(healthNumber(store.profile.stepsTarget)) ก้าว")
                                .font(.caption).foregroundStyle(RecompTheme.secondary)
                        }
                    }
                }
                Surface {
                    Label("การเคลื่อนไหวอื่น", systemImage: "figure.run").font(.headline)
                    HStack { Text("พลังงานที่ใช้"); Spacer(); Text(log?.activeEnergy.map { "\(healthNumber($0)) kcal" } ?? "—") }
                    HStack { Text("นาทีออกกำลัง"); Spacer(); Text(log?.exerciseMinutes.map { "\(healthNumber($0)) นาที" } ?? "—") }
                    HStack { Text("ชีพจรขณะพัก"); Spacer(); Text(log?.restingHeartRate.map { "\(healthNumber($0)) ครั้ง/นาที" } ?? "—") }
                }
                if let source = log?.sources?["steps"] {
                    Text("แหล่งข้อมูลก้าว: \(source == "appleHealth" ? "Apple Health" : "บันทึกเอง")")
                        .font(.caption).foregroundStyle(RecompTheme.secondary)
                }
            }
            .padding(20)
        }
        .background(RecompTheme.canvas.ignoresSafeArea())
        .navigationTitle("กิจกรรม")
    }
}

private struct StepsDetailView: View {
    @EnvironmentObject private var store: RecompStore
    @State private var range = 7
    private var records: [DayLog] { periodLogs(store.logs, days: range).filter { $0.steps != nil } }
    private var average: Double? {
        records.isEmpty ? nil : records.reduce(0) { $0 + ($1.steps ?? 0) } / Double(records.count)
    }
    private var priorAverage: Double? {
        let prior = periodLogs(store.logs, days: range, offset: range).compactMap(\.steps)
        return prior.isEmpty ? nil : prior.reduce(0, +) / Double(prior.count)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Picker("ช่วงเวลา", selection: $range) {
                    Text("สัปดาห์").tag(7)
                    Text("30 วัน").tag(30)
                }
                .pickerStyle(.segmented)
                Surface {
                    Text("เฉลี่ยวันที่มีข้อมูล").font(.caption).foregroundStyle(RecompTheme.secondary)
                    Text(average.map { "\(healthNumber($0)) ก้าว" } ?? "—")
                        .font(.system(size: 33, weight: .bold, design: .rounded))
                    if let average, let priorAverage {
                        let change = average - priorAverage
                        Text("\(change >= 0 ? "เพิ่ม" : "ลด") \(healthNumber(abs(change))) ก้าวจากช่วงก่อน")
                            .font(.subheadline).foregroundStyle(RecompTheme.secondary)
                    } else {
                        Text("ต้องมีข้อมูลทั้งสองช่วงจึงจะเปรียบเทียบได้")
                            .font(.caption).foregroundStyle(RecompTheme.secondary)
                    }
                }
                Surface {
                    Text("จำนวนก้าวรายวัน").font(.headline)
                    if records.isEmpty {
                        ContentUnavailableView("ยังไม่มีข้อมูลก้าว", systemImage: "figure.walk", description: Text("ซิงก์ Apple Health ในโปรไฟล์เพื่อดูแนวโน้ม"))
                    } else {
                        Chart {
                            ForEach(records) { item in
                                BarMark(x: .value("วัน", item.date), y: .value("ก้าว", item.steps ?? 0))
                                    .foregroundStyle(HealthLook.activity)
                                    .cornerRadius(4)
                            }
                            RuleMark(y: .value("เป้า", store.profile.stepsTarget))
                                .foregroundStyle(.secondary)
                                .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
                        }
                        .frame(height: 230)
                        Text("เส้นประคือเป้า \(healthNumber(store.profile.stepsTarget)) ก้าวต่อวัน")
                            .font(.caption).foregroundStyle(RecompTheme.secondary)
                    }
                }
                NavigationLink { StepsHistoryView() } label: {
                    MetricLine(symbol: "calendar", label: "ดูข้อมูลก้าวทั้งหมด", value: "", tint: HealthLook.activity)
                        .padding(16)
                        .background(RecompTheme.surface, in: RoundedRectangle(cornerRadius: 16))
                }
            }
            .padding(20)
        }
        .background(RecompTheme.canvas.ignoresSafeArea())
        .navigationTitle("ก้าว")
    }
}

private struct StepsHistoryView: View {
    @EnvironmentObject private var store: RecompStore
    private var records: [DayLog] { store.logs.filter { $0.steps != nil }.reversed() }

    var body: some View {
        List {
            if records.isEmpty {
                ContentUnavailableView("ยังไม่มีข้อมูลก้าว", systemImage: "calendar", description: Text("ซิงก์ Apple Health เพื่อเริ่มเก็บประวัติ"))
            } else {
                ForEach(records) { item in
                    HStack {
                        Text(healthDate(item.date))
                        Spacer()
                        Text("\(healthNumber(item.steps)) ก้าว").fontWeight(.semibold)
                    }
                }
            }
        }
        .navigationTitle("ประวัติก้าว")
    }
}

private struct NutritionDetailView: View {
    @EnvironmentObject private var store: RecompStore
    @State private var showFood = false
    private var log: DayLog? { store.today }
    private let meals = [("breakfast", "มื้อเช้า"), ("lunch", "มื้อกลางวัน"), ("dinner", "มื้อเย็น"), ("snacks", "ของว่าง")]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Surface {
                    Text("พลังงานวันนี้").font(.caption).foregroundStyle(RecompTheme.secondary)
                    Text("\(healthNumber(log?.calories)) kcal")
                        .font(.system(size: 34, weight: .bold, design: .rounded))
                    Text("เป้า \(healthNumber(store.calorieTarget)) kcal")
                        .font(.subheadline).foregroundStyle(RecompTheme.secondary)
                    ProgressView(value: min((log?.calories ?? 0) / max(store.calorieTarget, 1), 1))
                        .tint(HealthLook.nutrition)
                }
                Surface {
                    HStack { Text("โปรตีน"); Spacer(); Text("\(healthNumber(log?.protein)) / \(healthNumber(store.profile.proteinTarget)) g") }
                    HStack { Text("น้ำดื่ม"); Spacer(); Text("\(healthNumber(log?.water, digits: 1)) / \(healthNumber(store.profile.waterTarget, digits: 1)) L") }
                }
                SectionHeading(title: "มื้ออาหาร")
                Surface {
                    ForEach(meals, id: \.0) { key, title in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(title).fontWeight(.semibold)
                                Spacer()
                                Text(log?.meals?[key]?.calories.map { "\(healthNumber($0)) kcal" } ?? "—")
                                    .foregroundStyle(RecompTheme.secondary)
                            }
                            ForEach(log?.meals?[key]?.items ?? []) { item in
                                Text("• \(item.name)").font(.caption).foregroundStyle(RecompTheme.secondary)
                            }
                        }
                        if key != "snacks" { Divider() }
                    }
                }
                Button { showFood = true } label: {
                    Label("เพิ่มอาหาร", systemImage: "plus").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent).disabled(!store.connected)
            }
            .padding(20)
        }
        .background(RecompTheme.canvas.ignoresSafeArea())
        .navigationTitle("โภชนาการ")
        .sheet(isPresented: $showFood) { AIAddFoodSheet(date: store.todayKey) }
    }
}

private struct SleepDetailView: View {
    @EnvironmentObject private var store: RecompStore
    private var records: [DayLog] { periodLogs(store.logs, days: 14).filter { $0.sleep != nil } }
    private var average: Double? {
        records.isEmpty ? nil : records.reduce(0) { $0 + ($1.sleep ?? 0) } / Double(records.count)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Surface {
                    Text("การนอนล่าสุด").font(.caption).foregroundStyle(RecompTheme.secondary)
                    Text(healthSleep(store.today?.sleep))
                        .font(.system(size: 34, weight: .bold, design: .rounded))
                    Text("เฉลี่ยวันที่มีข้อมูลใน 14 วัน: \(healthSleep(average))")
                        .font(.subheadline).foregroundStyle(RecompTheme.secondary)
                }
                Surface {
                    Text("แนวโน้ม 14 วัน").font(.headline)
                    if records.isEmpty {
                        ContentUnavailableView("ยังไม่มีข้อมูลการนอน", systemImage: "moon.zzz", description: Text("บันทึกใน Journal หรือซิงก์ Apple Health"))
                    } else {
                        Chart(records) { item in
                            BarMark(x: .value("วัน", item.date), y: .value("ชั่วโมง", (item.sleep ?? 0) / 60))
                                .foregroundStyle(HealthLook.sleep)
                                .cornerRadius(4)
                        }
                        .frame(height: 200)
                    }
                }
                Surface {
                    Text("ประวัติ").font(.headline)
                    ForEach(records.reversed()) { item in
                        HStack { Text(healthDate(item.date)); Spacer(); Text(healthSleep(item.sleep)) }
                            .font(.subheadline)
                    }
                }
            }
            .padding(20)
        }
        .background(RecompTheme.canvas.ignoresSafeArea())
        .navigationTitle("การนอน")
    }
}

private struct WeightDetailView: View {
    @EnvironmentObject private var store: RecompStore
    private var records: [DayLog] { store.logs.filter { $0.weight != nil }.suffix(30) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Surface {
                    Text("น้ำหนักล่าสุด").font(.caption).foregroundStyle(RecompTheme.secondary)
                    Text(records.last?.weight.map { "\(healthNumber($0, digits: 1)) กก." } ?? "—")
                        .font(.system(size: 34, weight: .bold, design: .rounded))
                    if let last = records.last { Text(healthDate(last.date)).font(.caption).foregroundStyle(RecompTheme.secondary) }
                }
                Surface {
                    Text("แนวโน้ม").font(.headline)
                    if records.count > 1 {
                        Chart(records) { item in
                            LineMark(x: .value("วัน", item.date), y: .value("กิโลกรัม", item.weight ?? 0))
                                .foregroundStyle(RecompTheme.brand)
                            PointMark(x: .value("วัน", item.date), y: .value("กิโลกรัม", item.weight ?? 0))
                                .foregroundStyle(RecompTheme.brand)
                        }
                        .frame(height: 210)
                    } else {
                        Text("บันทึกน้ำหนักอย่างน้อย 2 วันเพื่อดูแนวโน้ม")
                            .foregroundStyle(RecompTheme.secondary)
                    }
                }
            }
            .padding(20)
        }
        .background(RecompTheme.canvas.ignoresSafeArea())
        .navigationTitle("น้ำหนัก")
    }
}

private struct HealthSearchView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    private let options = ["กิจกรรม", "ก้าว", "โภชนาการ", "การนอน", "น้ำหนัก"]
    private var filtered: [String] {
        query.isEmpty ? options : options.filter { $0.localizedCaseInsensitiveContains(query) }
    }

    var body: some View {
        NavigationStack {
            List(filtered, id: \.self) { option in
                NavigationLink(option) {
                    switch option {
                    case "กิจกรรม": ActivityDetailView()
                    case "ก้าว": StepsDetailView()
                    case "โภชนาการ": NutritionDetailView()
                    case "การนอน": SleepDetailView()
                    default: WeightDetailView()
                    }
                }
            }
            .searchable(text: $query, prompt: "ค้นหาข้อมูลสุขภาพ")
            .navigationTitle("ค้นหา")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("ปิด") { dismiss() } } }
        }
    }
}
