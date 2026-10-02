import SwiftUI

struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var diagnostics = Diagnostics()
    @State private var count = 0
    @State private var name = ""
    @State private var enabled = true
    @State private var slider = 0.5
    @State private var showsSheet = false
    @State private var animates = false

    var body: some View {
        TabView {
            Tab("Interact", systemImage: "hand.tap") {
                interactionView
            }
            Tab("Scroll", systemImage: "list.bullet") {
                scrollView
            }
            Tab("Diagnostics", systemImage: "waveform.path.ecg") {
                diagnosticsView
            }
        }
        .tint(.indigo)
        .onChange(of: scenePhase) { _, phase in
            if phase != .active {
                diagnostics.stop()
                animates = false
            }
        }
    }

    private var interactionView: some View {
        NavigationStack {
            Form {
                Section {
                    Label("A small playground for Mobile Dev", systemImage: "iphone")
                }
                Section("Tap") {
                    LabeledContent("Count", value: "\(count)")
                        .accessibilityIdentifier("counter.value")
                    Button("Increment", systemImage: "plus.circle") {
                        count += 1
                        diagnostics.logInteraction("increment")
                    }
                    .accessibilityIdentifier("counter.increment")
                    Button("Reset", systemImage: "arrow.counterclockwise") {
                        count = 0
                        diagnostics.logInteraction("reset")
                    }
                }
                Section("Type and adjust") {
                    TextField("Your name", text: $name)
                        .accessibilityIdentifier("input.name")
                        .submitLabel(.done)
                    if name.isEmpty == false {
                        Text("Hello, \(name)!")
                    }
                    Toggle("Enable feature", isOn: $enabled)
                        .accessibilityIdentifier("input.toggle")
                    Slider(value: $slider)
                        .accessibilityLabel("Test slider")
                    Text("Slider: \(slider, format: .percent.precision(.fractionLength(0)))")
                }
                Section("Present") {
                    Button("Open sheet", systemImage: "rectangle.portrait.on.rectangle.portrait") {
                        showsSheet = true
                        diagnostics.logInteraction("open sheet")
                    }
                }
            }
            .navigationTitle("Mobile Dev Test")
            .sheet(isPresented: $showsSheet) {
                NavigationStack {
                    ContentUnavailableView {
                        Label("Sheet is open", systemImage: "checkmark.circle")
                    } description: {
                        Text("Test dismissal with the button or a swipe.")
                    }
                        .toolbar {
                            ToolbarItem(placement: .confirmationAction) {
                                Button("Done") { showsSheet = false }
                            }
                        }
                }
                .presentationDetents([.medium, .large])
            }
        }
    }

    private var scrollView: some View {
        NavigationStack {
            List(1...200, id: \.self) { number in
                NavigationLink {
                    ContentUnavailableView {
                        Label("Item \(number)", systemImage: "square.stack")
                    } description: {
                        Text("Use Back or swipe from the left edge.")
                    }
                        .navigationTitle("Detail")
                        .onAppear { diagnostics.logInteraction("open list detail") }
                } label: {
                    HStack(spacing: 16) {
                        Image(systemName: "square.stack.fill")
                            .foregroundStyle(.indigo)
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Item \(number)")
                                .font(.headline)
                            Text("Scroll, inspect, or open this row")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 6)
                }
                .accessibilityIdentifier("list.item.\(number)")
            }
            .navigationTitle("Scroll test")
        }
    }

    private var diagnosticsView: some View {
        NavigationStack {
            Form {
                Section("Animation") {
                    Toggle("Animate", isOn: $animates)
                    if animates {
                        SpinnerView()
                            .frame(maxWidth: .infinity)
                            .frame(height: 100)
                    }
                }
                Section("Native logs") {
                    Button("Emit test logs", systemImage: "text.alignleft") {
                        diagnostics.emitLogs()
                    }
                    Text("Filter the plugin’s native logs to MobileDevTestApp.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Section("Performance") {
                    Button("Run CPU work for 5 seconds", systemImage: "cpu") {
                        Task { await diagnostics.runCPU() }
                    }
                    .disabled(diagnostics.isRunningCPU)
                    Button(diagnostics.holdsMemory ? "Release 32 MiB" : "Allocate 32 MiB", systemImage: "memorychip") {
                        diagnostics.toggleMemory()
                    }
                    Button("Stop and release", systemImage: "stop.circle") {
                        diagnostics.stop()
                    }
                    Text(diagnostics.status)
                        .accessibilityIdentifier("diagnostics.status")
                    Text("CPU work runs off the main thread. Leaving the app stops work and releases test memory.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Diagnostics")
        }
    }
}

private struct SpinnerView: View {
    @State private var spins = false

    var body: some View {
        Image(systemName: "fan.fill")
            .font(.system(size: 64))
            .foregroundStyle(.indigo)
            .rotationEffect(.degrees(spins ? 360 : 0))
            .animation(.linear(duration: 1).repeatForever(autoreverses: false), value: spins)
            .onAppear { spins = true }
            .accessibilityLabel("Rotating fan")
    }
}
