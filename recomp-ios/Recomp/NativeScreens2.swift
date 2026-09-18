import SwiftUI
import Charts

private func metric(_ value: Double?, decimals: Int = 0) -> String {
    FormatUtils.number(value, digits: decimals)
}

@MainActor private func recentLogs(_ logs: [DayLog], days: Int) -> [DayLog] {
    let cutoff = Calendar.current.date(byAdding: .day, value: -(days - 1), to: Date()) ?? Date()
    let key = RecompStore.dateKey(cutoff)
    return logs.filter { $0.date >= key }
}

struct ProgressScreen: View {
    @EnvironmentObject private var store: RecompStore
    @State private var range = 30

    private var recent: [DayLog] { recentLogs(store.logs, days: range) }
    private var weights: [DayLog] { recent.filter { $0.weight != nil } }
    private var peer: [DayLog] { recentLogs(store.peerLogs, days: range) }
    private var loggedMeals: Int { recent.filter { $0.calories != nil }.count }
    private var proteinDays: Int { recent.filter { ($0.protein ?? 0) >= store.profile.proteinTarget }.count }
    private var exerciseTotal: Double { recent.reduce(0) { $0 + ($1.exerciseMinutes ?? 0) } }
    private var challengeDay: Int {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        guard let start = formatter.date(from: "2026-08-30") else { return 1 }
        return min(max((Calendar.current.dateComponents([.day], from: start, to: Date()).day ?? 0) + 1, 1), 112)
    }

    var body: some View {
        Screen(title: "ความคืบหน้า") {
            Picker("ช่วงเวลา", selection: $range) {
                Text("7 วัน").tag(7)
                Text("30 วัน").tag(30)
            }
            .pickerStyle(.segmented)

            Surface {
                Label("แนวโน้มน้ำหนัก", systemImage: "chart.xyaxis.line").font(.headline)
                if weights.count > 1 {
                    Chart(weights) { log in
                        LineMark(x: .value("วันที่", log.date), y: .value("กิโลกรัม", log.weight ?? 0))
                            .foregroundStyle(RecompTheme.brand)
                            .interpolationMethod(.catmullRom)
                        PointMark(x: .value("วันที่", log.date), y: .value("กิโลกรัม", log.weight ?? 0))
                            .foregroundStyle(RecompTheme.brand)
                    }
                    .frame(height: 190)
                    .accessibilityLabel("กราฟน้ำหนักช่วง \(range) วัน")
                    Text("ล่าสุด \(metric(weights.last?.weight, decimals: 1)) กก. · \(weights.last?.date ?? "")")
                        .font(.footnote).foregroundStyle(RecompTheme.secondary)
                } else {
                    Text("บันทึกน้ำหนักอย่างน้อย 2 วันเพื่อดูแนวโน้ม")
                        .foregroundStyle(RecompTheme.secondary)
                }
            }

            Surface {
                Label("สิ่งที่ทำได้จริง", systemImage: "checkmark.seal").font(.headline)
                HStack(spacing: 12) {
                    evidence("บันทึกอาหาร", "\(loggedMeals)/\(range) วัน")
                    evidence("โปรตีนถึงเป้า", "\(proteinDays) วัน")
                }
                Text("ออกกำลัง \(metric(exerciseTotal)) นาทีในช่วง \(range) วัน")
                    .font(.subheadline).foregroundStyle(RecompTheme.secondary)
                Text(loggedMeals < range / 2 ? "ขั้นต่อไป: บันทึกมื้อถัดไปเพื่อให้เห็นภาพครบขึ้น" : "ขั้นต่อไป: ทบทวนโปรตีนและการเคลื่อนไหวในแต่ละวัน")
                    .font(.subheadline.weight(.medium))
            }

            Surface {
                HStack { Label("แผน 16 สัปดาห์", systemImage: "calendar").font(.headline); Spacer(); Text("วันที่ \(challengeDay)/112").font(.caption).foregroundStyle(RecompTheme.secondary) }
                ProgressView(value: Double(challengeDay), total: 112).tint(RecompTheme.brand)
                Text("เริ่ม 30 ส.ค. 2026 · บันทึกแล้ว \(store.logs.count) วัน")
                    .font(.caption).foregroundStyle(RecompTheme.secondary)
            }

            Surface {
                Label("เทียบกับเพื่อนร่วมชาเลนจ์", systemImage: "person.2").font(.headline)
                if peer.isEmpty {
                    Text("ยังไม่มีข้อมูลที่แชร์ในช่วงนี้")
                        .foregroundStyle(RecompTheme.secondary)
                } else {
                    let userCount = recent.filter { $0.calories != nil }.count
                    let peerCount = peer.filter { $0.calories != nil }.count
                    HStack(spacing: 12) {
                        comparison(store.profile.name, recent, isLeading: userCount >= peerCount)
                        comparison(NativeProfile.forID(store.peerProfileId ?? "tony").name, peer, isLeading: peerCount > userCount)
                    }
                    Text("เทียบความต่อเนื่องของการบันทึก ไม่ใช่น้ำหนักตัวระหว่างคน")
                        .font(.caption).foregroundStyle(RecompTheme.secondary)
                }
            }
        }
    }

    private func evidence(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(value).font(.title3.weight(.semibold))
            Text(title).font(.caption).foregroundStyle(RecompTheme.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func comparison(_ name: String, _ logs: [DayLog], isLeading: Bool) -> some View {
        let count = logs.filter { $0.calories != nil }.count
        let progress = min(Double(count) / Double(max(range, 1)), 1.0)
        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(name).font(.subheadline.weight(.semibold))
                    .foregroundStyle(RecompTheme.ink)
                Spacer()
                if isLeading && count > 0 {
                    Image(systemName: "crown.fill")
                        .font(.caption2)
                        .foregroundStyle(.yellow)
                }
            }
            HStack(alignment: .firstTextBaseline) {
                Text("\(count)")
                    .font(.title2.weight(.bold))
                    .foregroundStyle(isLeading ? RecompTheme.brand : RecompTheme.ink)
                Text("/\(range) วัน")
                    .font(.caption)
                    .foregroundStyle(RecompTheme.secondary)
            }
            ProgressView(value: progress)
                .tint(isLeading ? RecompTheme.brand : RecompTheme.secondary)
            Text("บันทึกอาหาร")
                .font(.caption2)
                .foregroundStyle(RecompTheme.secondary)
        }
        .padding(12)
        .background(RecompTheme.canvas, in: RoundedRectangle(cornerRadius: 14))
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct ExerciseDraft: Identifiable {
    let id = UUID()
    let name: String
    let scheme: String
    var done = false
    var weight = ""
    var reps = ""
    var rir = "2"
}

private struct WorkoutEditor: View {
    let type: String
    @EnvironmentObject private var store: RecompStore
    @Environment(\.dismiss) private var dismiss
    @State private var duration = "45"
    @State private var exercises: [ExerciseDraft]

    init(type: String) {
        self.type = type
        let names = type == "A"
            ? ["Squat", "Bench press", "Row", "Romanian deadlift", "Overhead press", "Plank"]
            : ["Deadlift", "Incline press", "Lat pulldown", "Split squat", "Lateral raise", "Curl"]
        _exercises = State(initialValue: names.map { ExerciseDraft(name: $0, scheme: "3 × 8") })
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("เวิร์กเอาต์ \(type)") {
                    HStack { Text("ระยะเวลา"); Spacer(); TextField("นาที", text: $duration).keyboardType(.numberPad).multilineTextAlignment(.trailing).frame(width: 70); Text("นาที") }
                    Text("เลือกท่าที่ทำจริงและกรอกอย่างน้อยจำนวนครั้ง")
                        .font(.caption).foregroundStyle(RecompTheme.secondary)
                }
                Section("รายการท่าฝึก") {
                    ForEach($exercises) { $exercise in
                        VStack(alignment: .leading, spacing: 8) {
                            Toggle(isOn: $exercise.done.animation(.easeInOut(duration: 0.2))) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(exercise.name).font(.subheadline.weight(.semibold))
                                        .foregroundStyle(RecompTheme.ink)
                                    Text("เป้าหมาย: \(exercise.scheme)")
                                        .font(.caption).foregroundStyle(RecompTheme.secondary)
                                }
                            }
                            if exercise.done {
                                HStack(spacing: 10) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("นน. (กก.)").font(.caption2).foregroundStyle(RecompTheme.secondary)
                                        TextField("0", text: $exercise.weight)
                                            .keyboardType(.decimalPad)
                                            .textFieldStyle(.roundedBorder)
                                    }
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("จำนวนครั้ง").font(.caption2).foregroundStyle(RecompTheme.secondary)
                                        TextField("ครั้ง", text: $exercise.reps)
                                            .keyboardType(.numberPad)
                                            .textFieldStyle(.roundedBorder)
                                    }
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("RIR").font(.caption2).foregroundStyle(RecompTheme.secondary)
                                        TextField("2", text: $exercise.rir)
                                            .keyboardType(.numberPad)
                                            .textFieldStyle(.roundedBorder)
                                    }
                                }
                                .padding(.top, 2)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }
            }
            .navigationTitle("แผน \(type)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("ยกเลิก") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("บันทึก") { Task { await save() } }
                        .disabled(!store.connected || !valid || store.isBusy)
                }
            }
        }
    }

    private var valid: Bool {
        let selected = exercises.filter(\.done)
        return !selected.isEmpty && selected.allSatisfy { (Int($0.reps) ?? 0) > 0 }
            && (Double(duration) ?? -1) >= 0 && (Double(duration) ?? 301) <= 300
    }

    private func save() async {
        let items = exercises.map { exercise in
            WorkoutExercise(
                name: exercise.name, scheme: exercise.scheme, done: exercise.done,
                rir: exercise.done ? Double(exercise.rir) : nil,
                sets: [WorkoutSet(weight: exercise.done ? Double(exercise.weight) : nil,
                                  reps: exercise.done ? Double(exercise.reps) : nil)]
            )
        }
        let session = WorkoutSession(date: store.todayKey, type: type,
                                     durationMinutes: Double(duration), exercises: items,
                                     completedExercises: items.filter(\.done).count)
        if await store.saveWorkout(session) { dismiss() }
    }
}

private struct QuickActivityEditor: View {
    @EnvironmentObject private var store: RecompStore
    @Environment(\.dismiss) private var dismiss
    @State private var name = "เดิน"
    @State private var minutes = "30"

    var body: some View {
        NavigationStack {
            Form {
                Section("กิจกรรม") {
                    TextField("เช่น เดินเร็ว ปั่นจักรยาน", text: $name)
                    HStack { Text("ระยะเวลา"); Spacer(); TextField("นาที", text: $minutes).keyboardType(.numberPad).multilineTextAlignment(.trailing).frame(width: 75); Text("นาที") }
                }
            }
            .navigationTitle("เพิ่มกิจกรรม")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("ยกเลิก") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("บันทึก") {
                        Task {
                            if await store.save(date: store.todayKey, fields: ["exerciseDescription": name.trimmingCharacters(in: .whitespaces), "exerciseMinutes": Double(minutes) ?? 0]) { dismiss() }
                        }
                    }
                    .disabled(!store.connected || name.trimmingCharacters(in: .whitespaces).isEmpty || (Double(minutes) ?? 0) <= 0 || (Double(minutes) ?? 1441) > 1440)
                }
            }
        }
    }
}

struct TrainView: View {
    @EnvironmentObject private var store: RecompStore
    @State private var selectedPlan: PlanSelection?
    @State private var showActivity = false

    var body: some View {
        Screen(title: "ฝึก") {
            Surface {
                Label("เวิร์กเอาต์แบบ A / B", systemImage: "figure.strengthtraining.traditional").font(.headline)
                Text("บันทึกเซตที่ทำจริง เพื่อดูความต่อเนื่องและใช้วางครั้งถัดไป")
                    .font(.subheadline).foregroundStyle(RecompTheme.secondary)
                HStack {
                    Button("เริ่มแผน A") { selectedPlan = PlanSelection(type: "A") }.buttonStyle(.borderedProminent)
                    Button("เริ่มแผน B") { selectedPlan = PlanSelection(type: "B") }.buttonStyle(.bordered)
                }
            }
            Surface {
                Label("กิจกรรมเร็ว", systemImage: "figure.walk").font(.headline)
                Text("เดิน ปั่นจักรยาน หรือกิจกรรมอื่น ๆ")
                    .foregroundStyle(RecompTheme.secondary)
                Button("เพิ่มกิจกรรม") { showActivity = true }.buttonStyle(.bordered)
            }
            Surface {
                Label("ประวัติการฝึก", systemImage: "clock.arrow.circlepath").font(.headline)
                if store.workouts.isEmpty {
                    Text("ยังไม่มีเวิร์กเอาต์ที่บันทึก")
                        .foregroundStyle(RecompTheme.secondary)
                } else {
                    ForEach(store.workouts.reversed().prefix(8)) { workout in
                        HStack {
                            VStack(alignment: .leading) {
                                Text("แผน \(workout.type)").font(.subheadline.weight(.semibold))
                                Text(workout.date).font(.caption).foregroundStyle(RecompTheme.secondary)
                            }
                            Spacer()
                            Text("\(workout.completedExercises ?? workout.exercises.filter(\.done).count) ท่า")
                                .font(.caption).foregroundStyle(RecompTheme.secondary)
                        }
                    }
                }
            }
            Surface {
                Label("จาก Apple Watch", systemImage: "applewatch").font(.headline)
                if store.healthWorkouts.isEmpty {
                    Text("ซิงก์ Apple Health เพื่อดูเวิร์กเอาต์จากนาฬิกา")
                        .foregroundStyle(RecompTheme.secondary)
                } else {
                    ForEach(store.healthWorkouts.reversed().prefix(5)) { workout in
                        HStack {
                            Text(workout.activityType.replacingOccurrences(of: "([a-z])([A-Z])", with: "$1 $2", options: .regularExpression).capitalized)
                            Spacer()
                            Text("\(metric(workout.durationMinutes)) นาที")
                                .foregroundStyle(RecompTheme.secondary)
                        }
                        .font(.subheadline)
                    }
                }
            }
            Text(store.status).font(.caption).foregroundStyle(RecompTheme.secondary)
        }
        .sheet(item: $selectedPlan) { plan in WorkoutEditor(type: plan.type) }
        .sheet(isPresented: $showActivity) { QuickActivityEditor() }
    }
}

private struct PlanSelection: Identifiable {
    let type: String
    var id: String { type }
}

struct ProfileView: View {
    @EnvironmentObject private var store: RecompStore
    @State private var exportURL: URL?
    @State private var calorieTarget = ""
    @State private var morning = false
    @State private var proteinReminder = false
    @State private var workoutReminder = false
    @State private var weeklyReview = false
    @State private var workoutDays: Set<Int> = []
    @State private var showDisconnect = false

    var body: some View {
        Screen(title: "โปรไฟล์") {
            Surface {
                Text(store.profile.name).font(.title2.weight(.semibold))
                Label(store.connected ? "เชื่อมต่อแล้ว" : "ยังไม่เชื่อมต่อ", systemImage: store.connected ? "checkmark.circle.fill" : "link")
                    .font(.subheadline).foregroundStyle(store.connected ? RecompTheme.brand : RecompTheme.secondary)
            }
            connection
            Surface {
                Label("เป้าหมายพลังงาน", systemImage: "scope").font(.headline)
                Text("ปัจจุบัน \(metric(store.calorieTarget)) kcal/วัน")
                    .font(.subheadline).foregroundStyle(RecompTheme.secondary)
                HStack {
                    TextField("kcal ต่อวัน", text: $calorieTarget).keyboardType(.numberPad)
                        .textFieldStyle(.roundedBorder)
                    Button("บันทึก") {
                        Task { if let value = Double(calorieTarget), await store.updatePlan(value) { calorieTarget = metric(store.calorieTarget) } }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(!store.connected || (Double(calorieTarget) ?? 0) < 800 || (Double(calorieTarget) ?? 5001) > 5000)
                }
                Text("ปรับเป้าหมายได้ไม่เกินหนึ่งครั้งต่อ 7 วัน")
                    .font(.caption).foregroundStyle(RecompTheme.secondary)
            }
            Surface {
                Label("Apple Health", systemImage: "heart.text.square").font(.headline)
                Text("ข้อมูลจาก Apple Watch จะมาผ่าน HealthKit บน iPhone เครื่องนี้")
                    .font(.caption).foregroundStyle(RecompTheme.secondary)
                Button(store.healthAuthorized ? "อนุญาตแล้ว" : "อนุญาต Apple Health") {
                    Task { await store.authorizeHealth() }
                }
                .buttonStyle(.bordered)
                Button("ซิงก์ 14 วันล่าสุด") { Task { await store.syncHealth() } }
                    .buttonStyle(.borderedProminent).disabled(!store.connected || store.isBusy)
                if let last = store.integration.lastSyncedAt {
                    Text("ซิงก์ล่าสุด \(last)").font(.caption).foregroundStyle(RecompTheme.secondary)
                }
            }
            Surface {
                Label("การแจ้งเตือน", systemImage: "bell.badge").font(.headline)
                Toggle("ชั่งน้ำหนักตอนเช้า", isOn: $morning)
                Toggle("เช็กโปรตีน", isOn: $proteinReminder)
                Toggle("ออกกำลังกาย", isOn: $workoutReminder)
                if workoutReminder {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("เลือกวันที่ต้องการให้เตือน").font(.caption).foregroundStyle(RecompTheme.secondary)
                        HStack(spacing: 6) {
                            ForEach(0..<7) { day in
                                let labels = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"]
                                let isSelected = workoutDays.contains(day)
                                Button {
                                    if isSelected { workoutDays.remove(day) }
                                    else { workoutDays.insert(day) }
                                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                                } label: {
                                    Text(labels[day])
                                        .font(.subheadline.weight(isSelected ? .bold : .medium))
                                        .frame(maxWidth: .infinity)
                                        .frame(height: 38)
                                        .background(isSelected ? RecompTheme.brand : RecompTheme.canvas, in: RoundedRectangle(cornerRadius: 10))
                                        .foregroundStyle(isSelected ? .white : RecompTheme.ink)
                                        .overlay(
                                            RoundedRectangle(cornerRadius: 10)
                                                .stroke(isSelected ? Color.clear : RecompTheme.secondary.opacity(0.25), lineWidth: 1)
                                        )
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("ฝึกวัน\(labels[day])")
                            }
                        }
                    }
                }
                Toggle("สรุปรายสัปดาห์", isOn: $weeklyReview)
                Button("บันทึกการแจ้งเตือน") {
                    let next = NativePreferences(morningWeighIn: morning, proteinReminder: proteinReminder,
                                                 workoutReminder: workoutReminder, weeklyReview: weeklyReview,
                                                 workoutDays: workoutDays.sorted())
                    Task { _ = await store.updatePreferences(next) }
                }
                .buttonStyle(.borderedProminent).disabled(!store.connected || store.isBusy)
            }
            Surface {
                Label("ข้อมูลและบัญชี", systemImage: "square.and.arrow.up").font(.headline)
                Button("เตรียมไฟล์ข้อมูล") {
                    Task { exportURL = try? await store.exportSnapshot() }
                }
                .buttonStyle(.bordered).disabled(!store.connected)
                if let exportURL {
                    ShareLink(item: exportURL) { Label("แชร์ไฟล์ JSON", systemImage: "square.and.arrow.up") }
                }
                Link("นำเข้า/กู้ข้อมูลบนเว็บ", destination: URL(string: "https://recomp-16-week.vercel.app")!)
                    .font(.subheadline)
            }
            Text(store.status).font(.caption).foregroundStyle(RecompTheme.secondary)
        }
        .onAppear(perform: loadSettings)
        .onChange(of: store.calorieTarget) { _, _ in calorieTarget = metric(store.calorieTarget) }
        .onChange(of: store.preferences.morningWeighIn) { _, _ in loadSettings() }
        .confirmationDialog("ลบ token ออกจาก iPhone เครื่องนี้?", isPresented: $showDisconnect) {
            Button("ลบ token", role: .destructive) { store.disconnect() }
        }
    }

    private func loadSettings() {
        calorieTarget = metric(store.calorieTarget)
        morning = store.preferences.morningWeighIn ?? false
        proteinReminder = store.preferences.proteinReminder ?? false
        workoutReminder = store.preferences.workoutReminder ?? false
        weeklyReview = store.preferences.weeklyReview ?? false
        workoutDays = Set(store.preferences.workoutDays ?? [1, 3, 6])
    }

    private var connection: some View {
        Surface {
            Label("เชื่อมกับ Recomp เว็บ", systemImage: "link").font(.headline)
            if store.connected {
                Text("ข้อมูลจะใช้ร่วมกับเว็บและอัปเดตเมื่อเปิดแอป")
                    .font(.subheadline).foregroundStyle(RecompTheme.secondary)
                Button("ลบ token จากเครื่อง", role: .destructive) { showDisconnect = true }
            } else {
                Picker("โปรไฟล์", selection: $store.profileId) {
                    Text("Zackdark").tag("zackdark")
                    Text("Tony").tag("tony")
                }
                .pickerStyle(.segmented)
                TextField("Endpoint จากเว็บ", text: $store.endpoint)
                    .textInputAutocapitalization(.never).autocorrectionDisabled().textFieldStyle(.roundedBorder)
                SecureField("Pairing token", text: $store.token)
                    .textInputAutocapitalization(.never).autocorrectionDisabled().textFieldStyle(.roundedBorder)
                Button("บันทึกและเชื่อมต่อ") { Task { await store.saveConnection() } }
                    .buttonStyle(.borderedProminent).disabled(store.isBusy)
                if let error = store.connectionError {
                    Text(error).font(.caption).foregroundStyle(.red)
                }
            }
        }
    }
}
