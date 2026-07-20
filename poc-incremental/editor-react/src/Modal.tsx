import { ReactNode, useEffect, useState, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';

// 极简模态：遮罩 + 卡片 + ✕ + Esc 关闭。resizable 时右下角可拖拽改变大小。
//   编辑器各处共用（预览 / 规则仓库 / 模型页的新增弹窗）。
export function Modal({ title, onClose, wide, resizable, children }: { title: string; onClose: () => void; wide?: boolean; resizable?: boolean; children: ReactNode }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // 拖拽右下角改变卡片宽高：以按下时的卡片矩形为起点，跟随指针增量，夹在最小尺寸与视口内。
  const startResize = (e: ReactPointerEvent) => {
    e.preventDefault();
    const card = (e.currentTarget as HTMLElement).parentElement as HTMLElement;
    const r = card.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY, sw = r.width, sh = r.height;
    const onMove = (ev: PointerEvent) => setSize({
      w: Math.min(window.innerWidth * 0.98, Math.max(520, sw + ev.clientX - sx)),
      h: Math.min(window.innerHeight * 0.96, Math.max(320, sh + ev.clientY - sy)),
    });
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  const style = size ? { width: size.w, height: size.h, maxWidth: '98vw', maxHeight: '96vh' } : undefined;
  // 可拖拽弹窗（预览）：点遮罩不关闭，只有「✕ 关闭」按钮 / Esc 关——避免拖拽改大小时误触消失。
  //   其它普通弹窗：保留点遮罩空白关闭（用 mousedown+判定事件源，避免选中文字后 mouseup 误关）。
  const onBackdrop = resizable ? undefined : (e: ReactMouseEvent) => { if (e.target === e.currentTarget) onClose(); };
  return (
    <div className="ed-modal-backdrop" onMouseDown={onBackdrop}>
      <div className={'ed-modal' + (wide ? ' wide' : '')} style={style}>
        <div className="ed-modal-h"><b>{title}</b><button className="mini" onClick={onClose}>✕ 关闭</button></div>
        <div className="ed-modal-body">{children}</div>
        {resizable && <div className="ed-modal-grip" title="拖拽改变大小" onPointerDown={startResize} />}
      </div>
    </div>
  );
}
