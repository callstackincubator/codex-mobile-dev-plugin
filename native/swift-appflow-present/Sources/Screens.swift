import SwiftUI

// None of the screens below says anything about when it is ready. That is the
// point: readiness is inferred from outside by the work ledger (`idle`) with a
// timeout backstop, so a real app needs no source changes to be captured. See
// Harness.swift.

// MARK: - 1. No-param screen

struct AboutView: View {
  var body: some View {
    VStack(spacing: 12) {
      Image(systemName: "info.circle.fill").font(.system(size: 48))
      Text("About").font(.largeTitle.bold())
      Text("Build 1.0 (proof)").foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color(white: 0.96))
    .navigationTitle("About")
  }
}

// MARK: - 2. Screen taking a model value

struct ProfileView: View {
  let user: User

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack(spacing: 14) {
        Circle().fill(.blue.gradient).frame(width: 64, height: 64)
          .overlay(Text(String(user.name.prefix(1))).font(.title.bold()).foregroundStyle(.white))
        VStack(alignment: .leading) {
          Text(user.name).font(.title2.bold())
          Text(user.handle).foregroundStyle(.secondary)
        }
      }
      Text("\(user.followers) followers").font(.headline)
      Text(user.bio)
      Spacer()
    }
    .padding()
    .frame(maxWidth: .infinity, alignment: .leading)
    .navigationTitle("Profile")
  }
}

// MARK: - 3. Screen taking a @Binding

struct CounterEditorView: View {
  @Binding var count: Int
  var label: String = "Quantity"

  var body: some View {
    VStack(spacing: 20) {
      Text(label).font(.headline)
      Text("\(count)").font(.system(size: 72, weight: .bold, design: .rounded))
        .monospacedDigit()
      HStack(spacing: 24) {
        Button { count -= 1 } label: { Image(systemName: "minus.circle.fill").font(.system(size: 40)) }
        Button { count += 1 } label: { Image(systemName: "plus.circle.fill").font(.system(size: 40)) }
      }
      Text("binding writes back to the host").font(.caption).foregroundStyle(.secondary)
      Spacer()
    }
    .padding(.top, 40)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .navigationTitle("Counter")
  }
}

// MARK: - 4. Screen reading app-root environment

struct AccountStatusView: View {
  @EnvironmentObject private var session: AppSession
  @Environment(\.themeAccent) private var accent

  var body: some View {
    VStack(spacing: 14) {
      Image(systemName: session.isPro ? "checkmark.seal.fill" : "seal")
        .font(.system(size: 56)).foregroundStyle(accent)
      Text(session.displayName).font(.title2.bold())
      Text(session.isPro ? "Pro member" : "Free plan")
        .padding(.horizontal, 12).padding(.vertical, 6)
        .background(accent.opacity(0.15), in: Capsule())
      Divider().padding(.vertical, 8)
      Text("session.tapCount = \(session.tapCount)").monospaced()
      Button("Increment session counter") { session.tapCount += 1 }
        .buttonStyle(.borderedProminent).tint(accent)
      Spacer()
    }
    .padding(.top, 40)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .navigationTitle("Account")
  }
}

// MARK: - 4b. Screen reading only a custom @Environment value
//
// Unlike @EnvironmentObject, a missing @Environment key does NOT trap: it
// silently falls back to `defaultValue`, so the screen renders in the wrong
// theme and the screenshot looks plausible while being wrong.

struct ThemeProbeView: View {
  @Environment(\.themeAccent) private var accent

  var body: some View {
    VStack(spacing: 18) {
      RoundedRectangle(cornerRadius: 20).fill(accent)
        .frame(width: 160, height: 160)
      Text("themeAccent").font(.headline)
      Text(accent == Color.gray ? "DEFAULT (environment missing)" : "injected at app root")
        .font(.caption).foregroundStyle(.secondary)
      Button("Primary action") {}
        .buttonStyle(.borderedProminent).tint(accent)
      Spacer()
    }
    .padding(.top, 40)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .navigationTitle("Theme")
  }
}

// MARK: - 4c. The negative control: a dependency nothing satisfies
//
// `brandTint` is never installed by the app root. This screen renders a
// complete, confident, wrong result -- grey where the brand colour should be --
// with no trap, no log line and no visual tell. The audit has to catch it.

struct BrandedHeaderView: View {
  @Environment(\.brandTint) private var brand

  var body: some View {
    VStack(spacing: 0) {
      ZStack {
        brand
        VStack(spacing: 6) {
          Image(systemName: "sparkles").font(.system(size: 34)).foregroundStyle(.white)
          Text("Acme Rewards").font(.title2.bold()).foregroundStyle(.white)
        }
      }
      .frame(height: 180)
      VStack(alignment: .leading, spacing: 10) {
        Text("Balance").font(.caption).foregroundStyle(.secondary)
        Text("3,420 points").font(.largeTitle.bold())
        Text("Earn 2x on every order this week.")
        Spacer()
      }
      .padding()
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .navigationTitle("Rewards")
  }
}

// MARK: - 5. Screen behind a navigationDestination(for:) route

struct OrderDetailView: View {
  let orderId: String
  @State private var note: String = ""

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      Text("Order \(orderId)").font(.largeTitle.bold())
      ForEach(Order.mock.items, id: \.self) { item in
        HStack { Text(item); Spacer(); Text("—").foregroundStyle(.secondary) }
      }
      Divider()
      HStack { Text("Total").bold(); Spacer(); Text("$48.50").bold() }
      TextField("Note for the barista", text: $note)
        .textFieldStyle(.roundedBorder)
      Spacer()
    }
    .padding()
    .frame(maxWidth: .infinity, alignment: .leading)
    .navigationTitle("Order")
  }
}

// MARK: - 6. Screen whose content is loaded asynchronously (the honest trap)

struct FeedView: View {
  @EnvironmentObject private var feed: FeedStore

  var body: some View {
    Group {
      if feed.isLoading {
        VStack(spacing: 12) {
          ProgressView().controlSize(.large)
          Text("Loading feed…").foregroundStyle(.secondary)
        }
      } else if feed.posts.isEmpty {
        ContentUnavailableView("No posts yet", systemImage: "tray",
                               description: Text("Pull to refresh."))
      } else {
        List(feed.posts, id: \.self) { Text($0) }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .navigationTitle("Feed")
    .onAppear { if feed.posts.isEmpty && !feed.isLoading { feed.load() } }
  }
}

// MARK: - 7. Remote image load (real URLSession, real network latency)
//
// `AsyncImage` owns its own `URLSession`; the app never sees the task. The
// screen can still declare readiness from the phase it is handed.

enum RemoteAsset {
  /// Served by Tools/serve-assets.py on the host; the simulator shares the
  /// host's loopback, so 127.0.0.1 reaches it.
  static let avatar = URL(string: "http://127.0.0.1:8766/avatar.png?delay=900")!
}

struct RemoteAvatarView: View {
  @State private var settled = false

  var body: some View {
    VStack(spacing: 16) {
      AsyncImage(url: RemoteAsset.avatar) { phase in
        switch phase {
        case .empty:
          ZStack {
            RoundedRectangle(cornerRadius: 24).fill(Color(white: 0.92))
            ProgressView()
          }
          .frame(width: 200, height: 200)
          .task { settled = false }
        case .success(let image):
          image.resizable().scaledToFit()
            .frame(width: 200, height: 200)
            .clipShape(RoundedRectangle(cornerRadius: 24))
            .task { settled = true }
        case .failure:
          ZStack {
            RoundedRectangle(cornerRadius: 24).fill(Color.red.opacity(0.12))
            VStack {
              Image(systemName: "wifi.slash").font(.system(size: 40))
              Text("image failed").font(.caption)
            }
          }
          .frame(width: 200, height: 200)
          .task { settled = true }
        @unknown default:
          EmptyView()
        }
      }
      Text("Remote avatar").font(.headline)
      Text(settled ? "image resolved" : "waiting on network")
        .font(.caption).foregroundStyle(.secondary)
      Spacer()
    }
    .padding(.top, 40)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .navigationTitle("Avatar")
  }
}

// MARK: - 8. Explicit, never-ending animation
//
// A screen whose steady state is motion. There is no frame at which
// consecutive frames stop differing, so a pixel-stability signal can only ever
// time out here -- while the screen is in fact ready from its first frame.

struct AnimatedBannerView: View {
  @State private var phase: CGFloat = 0

  var body: some View {
    VStack(spacing: 24) {
      ZStack {
        ForEach(0..<3, id: \.self) { i in
          Circle()
            .stroke(Color.purple.opacity(0.6), lineWidth: 6)
            .frame(width: 60 + CGFloat(i) * 50, height: 60 + CGFloat(i) * 50)
            .scaleEffect(1 + 0.18 * sin(phase + CGFloat(i)))
        }
        Image(systemName: "waveform").font(.system(size: 40))
          .rotationEffect(.degrees(Double(phase) * 12))
      }
      .frame(height: 220)
      Text("Always animating").font(.headline)
      Text("repeatForever: no frame is ever the last")
        .font(.caption).foregroundStyle(.secondary)
      Spacer()
    }
    .padding(.top, 40)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .navigationTitle("Banner")
    .onAppear {
      withAnimation(.linear(duration: 2).repeatForever(autoreverses: false)) {
        phase = .pi * 2
      }
    }
  }
}

// MARK: - 9. Legitimately empty by design
//
// Nothing is in flight, nothing ever arrives, and the empty state IS the
// screen. Any signal that waits for content to appear is wrong here.

struct EmptyInboxView: View {
  @EnvironmentObject private var inbox: InboxStore

  var body: some View {
    ContentUnavailableView("Inbox zero", systemImage: "checkmark.circle",
                           description: Text("You have no messages. There is nothing to load."))
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .navigationTitle("Inbox")
  }
}

// MARK: - 10. Data arriving in two stages

struct TwoStageOrderView: View {
  @EnvironmentObject private var store: TwoStageOrderStore

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      if let header = store.header {
        Text(header).font(.title2.bold())
      } else {
        Text("Loading order…").font(.title2.bold()).foregroundStyle(.secondary)
      }
      Divider()
      if store.items.isEmpty {
        // Stage 2 looks exactly like a finished, item-less order.
        Text("No line items").foregroundStyle(.secondary)
      } else {
        ForEach(store.items, id: \.self) { item in
          HStack { Text(item); Spacer(); Text("1").foregroundStyle(.secondary) }
        }
      }
      Spacer()
      Text("stage \(store.stage) of 3").font(.caption).monospaced()
        .foregroundStyle(.secondary)
    }
    .padding()
    .padding(.top, 24)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .navigationTitle("Order (staged)")
    .onAppear { store.load() }
  }
}

// MARK: - 11. A screen that brings its own NavigationStack
//
// Exists to prove that wrapping the presentation site in a NavigationStack does
// not break a screen that is already inside its own navigation container.

struct SelfContainedNavView: View {
  var body: some View {
    NavigationStack {
      List {
        Section("Owned by this screen") {
          Text("This screen has its own NavigationStack.")
          NavigationLink("Push a leaf") { Text("Leaf").navigationTitle("Leaf") }
        }
      }
      .navigationTitle("Self-contained")
    }
  }
}

// MARK: - App root (a real NavigationStack with route-driven destinations)

struct RootView: View {
  @State private var path = NavigationPath()

  var body: some View {
    NavigationStack(path: $path) {
      List {
        Section("Routes") {
          NavigationLink(value: Route.profile(.mock)) { Label("Profile", systemImage: "person") }
          NavigationLink(value: Route.orderDetail("A-1042")) { Label("Order A-1042", systemImage: "bag") }
          NavigationLink(value: Route.about) { Label("About", systemImage: "info.circle") }
        }
        Section("Live root") {
          Text("This list is the real app root.")
          Text("Registry presentations overlay it.")
        }
      }
      .navigationTitle("Demo App")
      .navigationDestination(for: Route.self) { route in
        switch route {
        case .profile(let user): ProfileView(user: user)
        case .orderDetail(let id): OrderDetailView(orderId: id)
        case .about: AboutView()
        }
      }
    }
  }
}
