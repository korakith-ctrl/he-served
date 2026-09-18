import Foundation

@main
struct DecodingSmoke {
    static func main() throws {
        let json = #"{"profileId":"tony","logs":{"2026-09-03":{"date":"2026-09-03","calories":650,"meals":{"breakfast":{"calories":300,"items":["ไข่ต้ม","ขนมปัง"]},"lunch":{"calories":350,"items":[{"name":"ข้าวกะเพรา","calories":350}]}}}},"plan":{"calorieTarget":2100},"appleHealth":{"paired":true}}"#
        let snapshot = try JSONDecoder().decode(NativeSnapshot.self, from: Data(json.utf8))
        precondition(snapshot.logs["2026-09-03"]?.meals?["breakfast"]?.calories == 300)
        precondition(snapshot.logs["2026-09-03"]?.meals?["lunch"]?.calories == 350)
        print("Legacy and current meal items decode successfully")
        if CommandLine.arguments.count == 4 {
            let logs = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
            let plan = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2])))
            let integration = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[3])))
            let live = try JSONSerialization.data(withJSONObject: [
                "profileId": "tony", "logs": logs, "plan": plan, "appleHealth": integration,
            ])
            let decoded = try JSONDecoder().decode(NativeSnapshot.self, from: live)
            print("Live snapshot decoded: \(decoded.logs.count) days")
        }
    }
}
