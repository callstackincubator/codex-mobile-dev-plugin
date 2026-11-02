export type PhysicalAndroidDevice = {
  udid: string;
  name: string;
  model?: string;
  state: string;
  runtime: string;
  platform: "android";
  kind: "physical";
  transportType: "wired" | "localNetwork";
};
