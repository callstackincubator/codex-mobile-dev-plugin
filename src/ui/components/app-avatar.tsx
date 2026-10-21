// An app's icon, or its initial while the icon loads or when it has none.
// The running dot matches the device picker so both pickers read the same way.
const sizes = {
  xs: { box: "size-4 text-[9px]", radius: "rounded-[4px]" },
  sm: { box: "size-6 text-xs", radius: "rounded-md" },
  md: { box: "size-8 text-sm", radius: "rounded-lg" },
};

// In light mode the placeholder and icon multiply into a hovered or selected row's grey, so white
// icon backgrounds and the placeholder keep their contrast; in dark mode the placeholder screens instead.
export function AppAvatar({ name, icon, size = "md", running = false, ring = "ring-popover", className = "" }: { name: string; icon?: string; size?: keyof typeof sizes; running?: boolean; ring?: string; className?: string }) {
  const look = sizes[size];
  return <span aria-hidden className={`relative grid shrink-0 place-items-center ${look.box} ${look.radius} ${className}`}>
    {icon ? <img src={icon} alt="" draggable={false} className={`size-full object-cover mix-blend-multiply dark:mix-blend-normal ${look.radius}`} />
      : <>
        <span className={`absolute inset-0 border bg-muted mix-blend-multiply dark:mix-blend-screen ${look.radius}`} />
        <span className="relative font-medium text-muted-foreground">{name.trim().charAt(0).toUpperCase() || "?"}</span>
      </>}
    {running && <span className={`absolute -right-0.5 -top-0.5 size-2 rounded-full bg-green-500 ring-2 ${ring}`} />}
  </span>;
}
