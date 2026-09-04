import SwiftUI

struct ContentView: View {
    @StateObject private var model = AppViewModel()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    hero
                    connectionCard
                    healthCard
                    privacyNote
                }
                .padding(20)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Recomp Health")
            .navigationBarTitleDisplayMode(.inline)
        }
        .tint(Color(red: 0.08, green: 0.53, blue: 0.34))
        .task { await model.resumeBackgroundUpdates() }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Image(systemName: "heart.text.square.fill").font(.system(size: 34)).foregroundStyle(.green)
                Spacer()
                Text("HEALTHKIT BRIDGE").font(.caption2.bold()).tracking(1.4).foregroundStyle(.secondary)
            }
            Text("Apple Watch → Recomp").font(.title2.bold())
            Text("ส่งเฉพาะค่าสรุปที่จำเป็นเข้า challenge เดิม โดยไม่ทับค่าที่คุณกรอกเอง")
                .font(.subheadline).foregroundStyle(.secondary)
        }
        .cardStyle()
    }

    private var connectionCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Secure pairing", systemImage: "lock.shield.fill").font(.headline)
            Picker("Profile", selection: $model.profileId) {
                Text("ZackDark").tag("zackdark")
                Text("Tony").tag("tony")
            }
            .pickerStyle(.segmented)
            TextField("Sync endpoint", text: $model.endpoint, axis: .vertical)
                .textInputAutocapitalization(.never).autocorrectionDisabled().textFieldStyle(.roundedBorder)
            SecureField("Pairing token จากเว็บ Recomp", text: $model.token)
                .textInputAutocapitalization(.never).autocorrectionDisabled().textFieldStyle(.roundedBorder)
            HStack {
                Button("Save connection") { model.saveConnection() }.buttonStyle(.borderedProminent)
                if !model.token.isEmpty { Button("Forget token", role: .destructive) { model.disconnect() }.buttonStyle(.bordered) }
            }
            Text("สร้าง token ที่เว็บ Recomp → กระดิ่ง → Apple Health · Beta")
                .font(.caption).foregroundStyle(.secondary)
        }
        .cardStyle()
    }

    private var healthCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Health access & sync", systemImage: "applewatch").font(.headline)
            HStack(spacing: 10) {
                metric("Steps", "figure.walk")
                metric("Sleep", "bed.double.fill")
                metric("Weight", "scalemass.fill")
                metric("Workout", "dumbbell.fill")
            }
            Button {
                Task { await model.authorize() }
            } label: {
                Label(model.isAuthorized ? "Health access granted" : "Allow Apple Health", systemImage: model.isAuthorized ? "checkmark.circle.fill" : "heart.circle")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            Button {
                Task { await model.sync() }
            } label: {
                Label(model.isBusy ? "Syncing…" : "Sync last 14 days", systemImage: "arrow.triangle.2.circlepath")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(model.isBusy || model.token.isEmpty)
            Divider()
            Text(model.status).font(.subheadline.bold())
            if let last = model.lastSyncedAt {
                Text("ล่าสุด \(last.formatted(date: .abbreviated, time: .shortened))")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .cardStyle()
    }

    private var privacyNote: some View {
            Label("ข้อมูลถูกส่งด้วย HTTPS และ token เก็บใน iPhone Keychain แอปอ่านเฉพาะ resting heart rate รายวัน ไม่อ่านชีพจรรายจังหวะหรือเส้นทางออกกำลังกาย", systemImage: "hand.raised.fill")
            .font(.caption).foregroundStyle(.secondary).padding(.horizontal, 4)
    }

    private func metric(_ title: String, _ icon: String) -> some View {
        VStack(spacing: 7) {
            Image(systemName: icon).foregroundStyle(.green)
            Text(title).font(.caption2.bold())
        }
        .frame(maxWidth: .infinity).padding(.vertical, 10)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
    }
}

private extension View {
    func cardStyle() -> some View {
        self.padding(18).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 20))
    }
}
