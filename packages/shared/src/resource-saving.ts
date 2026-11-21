export type ResourceSavingState = {
  supported?: boolean;
  profile?: "ram";
  ramMiB?: number;
  enabled: boolean;
  running: boolean;
  restartRequired: boolean;
};

export type ResourceSavingDevice = {
  platform: "ios" | "android";
  id: string;
  key: string;
  state: string;
};
