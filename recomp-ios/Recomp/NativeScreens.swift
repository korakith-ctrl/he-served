import SwiftUI
import PhotosUI
import UIKit

struct Screen<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) { content }
                    .padding(.horizontal, 20)
                    .padding(.top, 12)
                    .padding(.bottom, 32)
            }
            .background(RecompTheme.canvas.ignoresSafeArea())
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

struct Surface<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 14) { content }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RecompTheme.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }
}

private func formatted(_ value: Double?, digits: Int = 0) -> String {
    FormatUtils.number(value, digits: digits)
}

private func sleepFormatted(_ minutes: Double?) -> String {
    FormatUtils.sleepDuration(minutes)
}

private let mealNames = ["breakfast": "เช้า", "lunch": "กลางวัน", "dinner": "เย็น", "snacks": "ของว่าง"]
private let mealOrder = ["breakfast", "lunch", "dinner", "snacks"]

private enum FoodPresetLibrary {
    static let all: [FoodDraft] = {
        guard let url = Bundle.main.url(forResource: "FoodPresets", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let foods = try? JSONDecoder().decode([FoodDraft].self, from: data) else { return [] }
        return foods
    }()
}

private struct FoodLibraryView: View {
    let onSelect: (FoodDraft) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    private var results: [FoodDraft] {
        query.isEmpty ? FoodPresetLibrary.all : FoodPresetLibrary.all.filter {
            $0.name.localizedCaseInsensitiveContains(query) || $0.serving.localizedCaseInsensitiveContains(query)
        }
    }

    var body: some View {
        List(results, id: \.name) { food in
            Button {
                onSelect(food)
                dismiss()
            } label: {
                HStack {
                    VStack(alignment: .leading) {
                        Text(food.name).foregroundStyle(RecompTheme.ink)
                        Text(food.serving).font(.caption).foregroundStyle(RecompTheme.secondary)
                    }
                    Spacer()
                    Text("\(formatted(food.calories)) kcal").font(.subheadline).foregroundStyle(RecompTheme.secondary)
                }
            }
        }
        .navigationTitle("คลังอาหาร")
        .searchable(text: $query, prompt: "ค้นหาอาหาร 65 รายการ")
    }
}

private struct CameraPicker: UIViewControllerRepresentable {
    @Binding var image: UIImage?
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.cameraCaptureMode = .photo
        picker.delegate = context.coordinator
        return picker
    }
    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ parent: CameraPicker) { self.parent = parent }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            parent.image = info[.originalImage] as? UIImage
            parent.dismiss()
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.dismiss() }
    }
}

struct AIAddFoodSheet: View {
    let date: String
    @EnvironmentObject private var store: RecompStore
    @Environment(\.dismiss) private var dismiss
    @State private var mode = 0
    @State private var text = ""
    @State private var meal = "lunch"
    @State private var selectedPhoto: PhotosPickerItem?
    @State private var image: UIImage?
    @State private var showCamera = false
    @State private var foods: [FoodDraft] = []
    @State private var assumptions = ""
    @State private var daily: DailyEstimate?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("วิธีเพิ่ม", selection: $mode) {
                        Text("อาหาร").tag(0)
                        Text("ทั้งวัน").tag(1)
                        Text("กรอกเอง").tag(2)
                    }
                    .pickerStyle(.segmented)
                    
                    Text(modeDescription)
                        .font(.footnote)
                        .foregroundStyle(RecompTheme.secondary)
                }

                if mode == 0 { foodCapture }
                if mode == 1 { dayCapture }
                if mode == 2 { manualCapture }
                if !foods.isEmpty { foodReview }
                if let daily { dailyReview(daily) }
                if let error { Text(error).font(.footnote).foregroundStyle(.red) }
            }
            .animation(.easeInOut(duration: 0.2), value: mode)
            .animation(.easeInOut(duration: 0.2), value: foods.isEmpty)
            .navigationTitle("เพิ่มอาหาร")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("ปิด") { dismiss() } } }
            .sheet(isPresented: $showCamera) { CameraPicker(image: $image).ignoresSafeArea() }
            .onChange(of: selectedPhoto) { _, next in
                guard let next else { return }
                Task {
                    if let data = try? await next.loadTransferable(type: Data.self) { image = UIImage(data: data) }
                }
            }
            .onChange(of: mode) { _, _ in foods = []; daily = nil; error = nil }
        }
    }

    private var modeDescription: String {
        switch mode {
        case 0: return "ถ่ายรูปหรือพิมพ์ชื่ออาหารรายมื้อ ให้ AI ช่วยคำนวณสารอาหาร"
        case 1: return "พิมพ์เล่าสิ่งที่ทาน ดื่มน้ำ หรือกิจกรรมทั้งวันในข้อความเดียว"
        default: return "เลือกจากคลังอาหารยอดนิยม 65 รายการ หรือกรอกเองทีละรายการ"
        }
    }

    private var foodCapture: some View {
        Section("ถ่ายรูปหรือพิมพ์อาหาร") {
            TextField("เช่น กะเพราไก่ไข่ดาว 1 จาน", text: $text, axis: .vertical)
                .lineLimit(2...4)
            HStack {
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    Button { showCamera = true } label: { Label("ถ่ายรูป", systemImage: "camera") }
                }
                PhotosPicker(selection: $selectedPhoto, matching: .images) {
                    Label("เลือกรูป", systemImage: "photo.on.rectangle")
                }
            }
            if let image {
                Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: 190)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                Button("ลบรูป", role: .destructive) { self.image = nil; selectedPhoto = nil }
            }
            mealPicker
            Button {
                Task { await analyzeFood() }
            } label: {
                HStack(spacing: 8) {
                    if store.isAnalyzing {
                        ProgressView().tint(.white)
                        Text("กำลังประเมินด้วย AI…")
                    } else {
                        Label("ประเมินด้วย AI", systemImage: "sparkles")
                    }
                }
                .font(.headline)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 2)
            }
            .buttonStyle(.borderedProminent)
            .disabled(!store.connected || store.isAnalyzing || (image == nil && text.trimmingCharacters(in: .whitespaces).count < 3))
            Text("AI ประเมินจากภาพหรือข้อความ ค่าจริงอาจต่างจากนี้ ตรวจทานก่อนบันทึก")
                .font(.caption).foregroundStyle(RecompTheme.secondary)
        }
    }

    private var dayCapture: some View {
        Section("เล่าทั้งวันในครั้งเดียว") {
            TextField("เช้าไข่ต้ม 2 ฟอง เที่ยงกะเพราไก่ ดื่มน้ำ 1 ลิตร เดิน 30 นาที…", text: $text, axis: .vertical)
                .lineLimit(4...8)
            Button { Task { await parseDay() } } label: {
                HStack(spacing: 8) {
                    if store.isAnalyzing {
                        ProgressView().tint(.white)
                        Text("กำลังแยกข้อมูล…")
                    } else {
                        Label("แยกอาหาร น้ำ และกิจกรรม", systemImage: "sparkles")
                    }
                }
                .font(.headline)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 2)
            }
            .buttonStyle(.borderedProminent)
            .disabled(!store.connected || store.isAnalyzing || text.trimmingCharacters(in: .whitespaces).count < 10)
        }
    }

    private var manualCapture: some View {
        Section("กรอกเอง / อาหารที่ใช้บ่อย") {
            mealPicker
            NavigationLink {
                FoodLibraryView { preset in
                    foods.append(preset)
                    assumptions = "ค่ามาตรฐานจากคลังอาหาร แก้ปริมาณให้ตรงก่อนบันทึก"
                }
            } label: { Label("ค้นหาคลังอาหาร 65 รายการ", systemImage: "list.bullet") }
            Button { foods = [FoodDraft(name: "", serving: "1 ส่วน", source: "native")]; assumptions = "กรอกค่าจากฉลากหรือประมาณด้วยตนเอง" }
                label: { Label("เพิ่มรายการเปล่า", systemImage: "plus") }
        }
    }

    private var mealPicker: some View {
        Picker("มื้อ", selection: $meal) {
            ForEach(mealOrder, id: \.self) { key in Text(mealNames[key] ?? key).tag(key) }
        }
    }

    private var foodReview: some View {
        Section("ตรวจทานก่อนบันทึก") {
            if !assumptions.isEmpty { Text(assumptions).font(.caption).foregroundStyle(RecompTheme.secondary) }
            ForEach(foods.indices, id: \.self) { index in
                VStack(alignment: .leading, spacing: 9) {
                    TextField("ชื่ออาหาร", text: $foods[index].name)
                        .font(.subheadline.weight(.semibold))
                    TextField("ปริมาณ เช่น 1 จาน", text: $foods[index].serving)
                    HStack {
                        nutrientField("kcal", value: $foods[index].calories)
                        nutrientField("โปรตีน g", value: $foods[index].protein)
                    }
                    HStack {
                        nutrientField("คาร์บ g", value: $foods[index].carbs)
                        nutrientField("ไขมัน g", value: $foods[index].fat)
                    }
                    HStack {
                        nutrientField("ใยอาหาร g", value: $foods[index].fiber)
                        nutrientField("ผักผลไม้", value: $foods[index].produceServings)
                    }
                }
            }
            Button("ยืนยันและบันทึก") {
                Task {
                    if await store.addFoods(date: date, meal: meal, foods: foods) { dismiss() }
                    else { error = store.status }
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(!store.connected || foods.isEmpty || foods.contains { $0.name.trimmingCharacters(in: .whitespaces).isEmpty || $0.serving.trimmingCharacters(in: .whitespaces).isEmpty })
        }
    }

    private func dailyReview(_ draft: DailyEstimate) -> some View {
        Section("ตรวจทานบันทึกทั้งวัน") {
            if !draft.assumptions.isEmpty {
                Text(draft.assumptions).font(.caption).foregroundStyle(RecompTheme.secondary)
            }
            ForEach(draft.foods.indices, id: \.self) { index in
                VStack(alignment: .leading, spacing: 6) {
                    TextField("ชื่ออาหาร", text: Binding(get: { daily?.foods[index].name ?? "" }, set: { daily?.foods[index].name = $0 }))
                        .font(.subheadline.weight(.semibold))
                    TextField("ปริมาณ", text: Binding(get: { daily?.foods[index].serving ?? "" }, set: { daily?.foods[index].serving = $0 }))
                    HStack {
                        nutrientField("kcal", value: Binding(get: { daily?.foods[index].calories ?? 0 }, set: { daily?.foods[index].calories = $0 }))
                        nutrientField("โปรตีน g", value: Binding(get: { daily?.foods[index].protein ?? 0 }, set: { daily?.foods[index].protein = $0 }))
                    }
                    HStack {
                        nutrientField("คาร์บ g", value: Binding(get: { daily?.foods[index].carbs ?? 0 }, set: { daily?.foods[index].carbs = $0 }))
                        nutrientField("ไขมัน g", value: Binding(get: { daily?.foods[index].fat ?? 0 }, set: { daily?.foods[index].fat = $0 }))
                    }
                    Picker("มื้อ", selection: Binding(
                        get: { daily?.foods[index].meal ?? "unassigned" },
                        set: { daily?.foods[index].meal = $0 }
                    )) {
                        Text("เลือกมื้อ").tag("unassigned")
                        ForEach(mealOrder, id: \.self) { key in Text(mealNames[key] ?? key).tag(key) }
                    }
                }
            }
            if draft.waterMentioned {
                HStack { Text("น้ำดื่ม"); Spacer(); TextField("ลิตร", value: Binding(get: { daily?.waterLiters ?? 0 }, set: { daily?.waterLiters = $0 }), format: .number).keyboardType(.decimalPad).multilineTextAlignment(.trailing).frame(width: 90); Text("ลิตร") }
            }
            if draft.exerciseMentioned {
                TextField("กิจกรรม", text: Binding(get: { daily?.exerciseDescription ?? "" }, set: { daily?.exerciseDescription = $0 }))
                HStack { Text("เวลา"); Spacer(); TextField("นาที", value: Binding(get: { daily?.exerciseMinutes ?? 0 }, set: { daily?.exerciseMinutes = $0 }), format: .number).keyboardType(.numberPad).multilineTextAlignment(.trailing).frame(width: 90); Text("นาที") }
            }
            if draft.stepsMentioned { Text("ก้าว \(formatted(draft.steps))") }
            if draft.foods.contains(where: { $0.meal == "unassigned" || $0.meal == nil }) {
                Text("เลือกมื้อให้ครบทุกรายการก่อนบันทึก").font(.caption).foregroundStyle(RecompTheme.food)
            }
            Button("ยืนยันบันทึกทั้งวัน") {
                guard let daily else { return }
                Task {
                    if await store.confirmDaily(date: date, draft: daily) { dismiss() }
                    else { error = store.status }
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(!store.connected || draft.foods.contains { $0.meal == "unassigned" || $0.meal == nil })
        }
    }

    private func nutrientField(_ label: String, value: Binding<Double>) -> some View {
        VStack(alignment: .leading) {
            Text(label).font(.caption).foregroundStyle(RecompTheme.secondary)
            TextField(label, value: value, format: .number)
                .keyboardType(.decimalPad)
                .textFieldStyle(.roundedBorder)
        }
    }

    private func analyzeFood() async {
        error = nil
        do {
            let jpeg: Data?
            if let image {
                let scale = min(1, 1600 / max(image.size.width, image.size.height))
                let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
                let renderer = UIGraphicsImageRenderer(size: size)
                jpeg = renderer.jpegData(withCompressionQuality: 0.72) { _ in
                    image.draw(in: CGRect(origin: .zero, size: size))
                }
                guard let jpeg, jpeg.count <= 5_000_000 else {
                    throw NSError(domain: "Recomp", code: 413, userInfo: [NSLocalizedDescriptionKey: "รูปใหญ่เกิน 5 MB กรุณาเลือกรูปใหม่"])
                }
            } else { jpeg = nil }
            let estimate = try await store.estimateFood(description: jpeg == nil ? text : nil, imageJPEG: jpeg)
            guard estimate.isFood, !estimate.foods.isEmpty else {
                error = estimate.assumptions.isEmpty ? "ยังไม่พบอาหารที่ประเมินได้" : estimate.assumptions
                return
            }
            foods = estimate.foods.map { item in
                var food = item
                food.source = "food-photo-estimate"
                return food
            }
            assumptions = estimate.assumptions
        } catch { self.error = error.localizedDescription }
    }

    private func parseDay() async {
        error = nil
        do {
            var result = try await store.parseDailyText(text)
            result.foods = result.foods.map { item in
                var food = item
                food.source = "daily-text-estimate"
                return food
            }
            daily = result
        } catch { self.error = error.localizedDescription }
    }
}

struct JournalView: View {
    @EnvironmentObject private var store: RecompStore
    @State private var date = Date()
    @State private var showAdd = false
    @State private var water = ""
    @State private var weight = ""
    @State private var sleep = ""
    @State private var exercise = ""
    @State private var exerciseDescription = ""
    @State private var notes = ""
    @State private var loadedDate = ""
    @State private var saveSuccessTrigger = 0
    @State private var showSavedNotice = false

    private var key: String { RecompStore.dateKey(date) }
    private var existing: DayLog? { store.logs.first { $0.date == key } }
    private var fields: [String: Any] {
        var result: [String: Any] = [:]
        func changedNumber(_ name: String, _ text: String, _ old: Double?) {
            if let value = Double(text.replacingOccurrences(of: ",", with: ".")), value != old { result[name] = value }
        }
        changedNumber("water", water, existing?.water)
        changedNumber("weight", weight, existing?.weight)
        changedNumber("sleep", sleep, existing?.sleep)
        changedNumber("exerciseMinutes", exercise, existing?.exerciseMinutes)
        if exerciseDescription != (existing?.exerciseDescription ?? "") { result["exerciseDescription"] = exerciseDescription }
        if notes != (existing?.notes ?? "") { result["notes"] = notes }
        return result
    }

    var body: some View {
        Screen(title: "บันทึก") {
            HStack {
                DatePicker("วันที่", selection: $date, in: ...Date(), displayedComponents: .date)
                    .labelsHidden()
                Spacer()
                Button { showAdd = true } label: { Label("เพิ่มอาหาร", systemImage: "plus") }
                    .buttonStyle(.borderedProminent).disabled(!store.connected)
            }
            Surface {
                Label("มื้ออาหาร", systemImage: "fork.knife").font(.headline)
                ForEach(mealOrder, id: \.self) { meal in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(mealNames[meal] ?? meal).font(.subheadline.weight(.medium))
                            Spacer()
                            Text(existing?.meals?[meal]?.calories.map { "\(formatted($0)) kcal" } ?? "—")
                                .font(.subheadline).foregroundStyle(RecompTheme.secondary)
                        }
                        ForEach(existing?.meals?[meal]?.items ?? []) { item in
                            Text("• \(item.name)\(item.serving.map { " · \($0)" } ?? "")")
                                .font(.caption).foregroundStyle(RecompTheme.secondary)
                        }
                    }
                    if meal != "snacks" { Divider() }
                }
                if let log = existing {
                    Text("รวม \(formatted(log.calories)) kcal · โปรตีน \(formatted(log.protein)) g")
                        .font(.caption.weight(.medium)).foregroundStyle(RecompTheme.ink)
                }
            }
            Surface {
                Label("รายละเอียดวันนี้", systemImage: "square.and.pencil").font(.headline)
                entry("น้ำดื่ม", "ลิตร", $water)
                HStack(spacing: 10) {
                    Button {
                        let cur = Double(water.replacingOccurrences(of: ",", with: ".")) ?? 0
                        water = formatted(cur + 0.25, digits: 2)
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    } label: {
                        Label("+250 มล.", systemImage: "drop.fill")
                            .font(.subheadline.weight(.medium))
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .tint(RecompTheme.water)

                    Button {
                        let cur = Double(water.replacingOccurrences(of: ",", with: ".")) ?? 0
                        water = formatted(cur + 0.5, digits: 2)
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    } label: {
                        Label("+500 มล.", systemImage: "drop.fill")
                            .font(.subheadline.weight(.medium))
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .tint(RecompTheme.water)
                }
                entry("น้ำหนัก", "กก.", $weight)
                entry("นอน", "นาที", $sleep)
                entry("ออกกำลัง", "นาที", $exercise)
                TextField("ชนิดกิจกรรม", text: $exerciseDescription)
                    .textFieldStyle(.roundedBorder)
                TextField("โน้ต", text: $notes, axis: .vertical)
                    .lineLimit(2...4).textFieldStyle(.roundedBorder)
            }
            Button {
                Task {
                    if await store.save(date: key, fields: fields) {
                        load(force: true)
                        saveSuccessTrigger += 1
                        withAnimation { showSavedNotice = true }
                        try? await Task.sleep(nanoseconds: 2_500_000_000)
                        withAnimation { showSavedNotice = false }
                    }
                }
            } label: {
                HStack(spacing: 8) {
                    if store.isBusy {
                        ProgressView().tint(.white)
                        Text("กำลังบันทึก…")
                    } else if showSavedNotice {
                        Image(systemName: "checkmark.circle.fill")
                        Text("บันทึกเรียบร้อย")
                    } else {
                        Image(systemName: "checkmark")
                        Text("บันทึกการเปลี่ยนแปลง")
                    }
                }
                .font(.headline)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
            }
            .buttonStyle(.borderedProminent)
            .tint(showSavedNotice ? .green : RecompTheme.brand)
            .disabled(!store.connected || (fields.isEmpty && !showSavedNotice) || store.isBusy)
            .sensoryFeedback(.success, trigger: saveSuccessTrigger)
            Text(store.status).font(.caption).foregroundStyle(RecompTheme.secondary)
        }
        .animation(.easeInOut(duration: 0.25), value: showSavedNotice)
        .onAppear { load() }
        .onChange(of: key) { _, _ in load(force: true) }
        .onChange(of: showAdd) { _, open in if !open { load(force: true) } }
        .sheet(isPresented: $showAdd) { AIAddFoodSheet(date: key) }
    }

    private func load(force: Bool = false) {
        guard force || loadedDate != key else { return }
        water = existing?.water.map { formatted($0, digits: 2) } ?? ""
        weight = existing?.weight.map { formatted($0, digits: 1) } ?? ""
        sleep = existing?.sleep.map { formatted($0) } ?? ""
        exercise = existing?.exerciseMinutes.map { formatted($0) } ?? ""
        exerciseDescription = existing?.exerciseDescription ?? ""
        notes = existing?.notes ?? ""
        loadedDate = key
    }

    private func entry(_ title: String, _ unit: String, _ value: Binding<String>) -> some View {
        HStack {
            Text(title)
            Spacer()
            TextField(unit, text: value).keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing).frame(width: 85)
            Text(unit).font(.caption).foregroundStyle(RecompTheme.secondary)
        }
        .padding(11)
        .background(RecompTheme.canvas, in: RoundedRectangle(cornerRadius: 12))
    }
}
