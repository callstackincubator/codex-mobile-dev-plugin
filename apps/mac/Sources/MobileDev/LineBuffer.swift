import Foundation

/// Splits a byte stream into newline-terminated lines, as MCP's stdio transport frames messages.
struct LineBuffer {
  private var pending = Data()

  /// Appends bytes and returns every line they complete, without the newline.
  mutating func append(_ data: Data) -> [Data] {
    pending.append(data)
    var lines: [Data] = []
    while let newline = pending.firstIndex(of: 0x0A) {
      lines.append(pending[pending.startIndex..<newline])
      pending.removeSubrange(pending.startIndex...newline)
    }
    return lines
  }
}
