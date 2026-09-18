import SwiftUI

@main
struct RecompApp: App {
    @StateObject private var store = RecompStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .task { await store.refresh() }
                .tint(RecompTheme.accent)
        }
    }
}
