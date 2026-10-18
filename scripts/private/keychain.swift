import Foundation
import Security

let args = CommandLine.arguments
if args.count != 3 { exit(2) }
let action = args[1], account = args[2]
let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "sap-developer-shorts-render-worker",
    kSecAttrAccount as String: account]
var status: OSStatus = errSecParam
if action == "put" {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    if status == errSecItemNotFound {
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        status = SecItemAdd(add as CFDictionary, nil)
    }
} else if action == "get" {
    var lookup = query
    lookup[kSecReturnData as String] = true
    lookup[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    status = SecItemCopyMatching(lookup as CFDictionary, &result)
    if status == errSecSuccess, let data = result as? Data { FileHandle.standardOutput.write(data) }
} else if action == "delete" { status = SecItemDelete(query as CFDictionary) }
if status != errSecSuccess { FileHandle.standardError.write(Data("Keychain operation failed (\(status)).\n".utf8)); exit(1) }
