import SwiftUI

enum RecompTheme {
    static let canvas = Color("Canvas")
    static let surface = Color("Surface")
    static let ink = Color("Ink")
    static let secondary = Color("Secondary")
    static let brand = Color("Brand")
    static let accent = brand
    static let food = Color("Food")
    static let water = Color("Water")
    static let activity = Color("Activity")
}

struct RootView: View {
    @EnvironmentObject private var store: RecompStore
    @Environment(\.scenePhase) private var scenePhase
    @State private var selectedTab = 0
    var body: some View {
        TabView(selection: $selectedTab) {
            TodayView(selectedTab: $selectedTab).tabItem { Label("วันนี้", systemImage: "sun.max.fill") }.tag(0)
            JournalView().tabItem { Label("บันทึก", systemImage: "square.and.pencil") }.tag(1)
            ProgressScreen().tabItem { Label("แนวโน้ม", systemImage: "chart.bar.xaxis") }.tag(2)
            TrainView().tabItem { Label("ฝึก", systemImage: "figure.strengthtraining.traditional") }.tag(3)
            ProfileView().tabItem { Label("โปรไฟล์", systemImage: "person.crop.circle") }.tag(4)
        }
        .tint(RecompTheme.brand)
        .task { await store.resumeHealth() }
        .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await store.refresh() } } }
    }
}
