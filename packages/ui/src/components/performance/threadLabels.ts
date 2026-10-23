const iosThreadLabels = new Map([
  ["hades", "Hermes GC"],
  ["com.apple.NSURLConnectionLoader", "Network loader"],
]);

export function threadLabel(name: string, number: number, platform: "ios" | "android"): string {
  if (name === "") return `Unnamed thread #${number}`;
  if (platform === "ios") {
    const role = iosThreadLabels.get(name);
    if (role !== undefined) return role;
  }
  return name;
}
