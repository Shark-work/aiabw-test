/**
 * 半透明 © 水印：叠加在宠物高清大图右下角，防止截图后被直接盗用。
 * 父容器需为 `relative`；组件本身 pointer-events-none 不遮挡交互。
 */
export function PetWatermark({ label = "© 艾比世界" }: { label?: string }) {
  return (
    <span
      aria-hidden
      className="pet-watermark pointer-events-none absolute bottom-1 right-1 z-10 select-none rounded bg-black/40 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-white/80 backdrop-blur-[1px]"
    >
      {label}
    </span>
  );
}
