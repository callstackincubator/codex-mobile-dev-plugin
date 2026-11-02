/// Which device platforms are visible. Raw values match the web page's layout names.
enum DeviceLayout: String {
  case ios
  case android
  case both
  case none

  init(showsIOS: Bool, showsAndroid: Bool) {
    switch (showsIOS, showsAndroid) {
    case (true, true): self = .both
    case (true, false): self = .ios
    case (false, true): self = .android
    case (false, false): self = .none
    }
  }

  var showsIOS: Bool { self == .ios || self == .both }
  var showsAndroid: Bool { self == .android || self == .both }
}
