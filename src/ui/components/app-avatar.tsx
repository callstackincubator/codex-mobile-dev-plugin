// An app's icon, or its initial while the icon loads or when it has none.
// The running dot matches the device picker so both pickers read the same way.
const sizes = {
  xs: { box: "size-4 rounded-[4px] text-[9px]", image: "rounded-[4px]" },
  sm: { box: "size-6 rounded-md text-xs", image: "rounded-md" },
  md: { box: "size-8 rounded-lg text-sm", image: "rounded-lg" },
};

export function AppAvatar({ name, icon, size = "md", running = false, ring = "ring-popover" }: { name: string; icon?: string; size?: keyof typeof sizes; running?: boolean; ring?: string }) {
  const look = sizes[size];
  return <span aria-hidden className={`relative grid shrink-0 place-items-center ${look.box} ${icon ? "" : "border bg-muted font-medium text-muted-foreground"}`}>
    {icon ? <img src={icon} alt="" draggable={false} className={`size-full object-cover ${look.image}`} /> : name.trim().charAt(0).toUpperCase() || "?"}
    {running && <span className={`absolute -right-0.5 -top-0.5 size-2 rounded-full bg-green-500 ring-2 ${ring}`} />}
  </span>;
}
