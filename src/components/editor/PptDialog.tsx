import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
} from "@fluentui/react-components";
import { useEditor } from "../../stores/editor";

interface PptDialogProps {
  open: boolean;
  onClose: () => void;
  onGenerate: () => void;
}

export function PptDialog({ open, onClose, onGenerate }: PptDialogProps) {
  const pptSettings = useEditor((s) => s.pptSettings);
  const setPptSettings = useEditor((s) => s.setPptSettings);

  const setListenTimes = (n: number) => {
    const speeds = Array.from({ length: n }, () => pptSettings.speeds[0] ?? 1);
    setPptSettings({ listenTimes: n, speeds });
  };
  const setSpeed = (v: number) => {
    const speeds = Array.from({ length: pptSettings.listenTimes }, () => v);
    setPptSettings({ speeds });
  };

  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>生成 PPT</DialogTitle>
          <DialogContent>
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
              <Field label="每句听几遍">
                <Input
                  type="number"
                  min={1}
                  max={10}
                  style={{ width: "120px" }}
                  value={String(pptSettings.listenTimes)}
                  onChange={(_, d) => {
                    const n = Math.max(1, Math.min(10, parseInt(d.value, 10) || 1));
                    setListenTimes(n);
                  }}
                />
              </Field>
              <Field label="每遍间隔（秒）">
                <Input
                  type="number"
                  min={0}
                  step="0.1"
                  style={{ width: "140px" }}
                  value={String(pptSettings.gapSeconds)}
                  onChange={(_, d) => {
                    const v = parseFloat(d.value);
                    setPptSettings({ gapSeconds: Number.isFinite(v) ? Math.max(0, v) : 0 });
                  }}
                />
              </Field>
            </div>
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
              <Field
                label="倍速"
                hint="每个句子每次播放的速度；1.0 为原速，小于 1 更慢，大于 1 更快"
              >
                <Input
                  type="number"
                  min={0.5}
                  max={2}
                  step="0.05"
                  style={{ width: "140px" }}
                  value={String(pptSettings.speeds[0] ?? 1)}
                  onChange={(_, d) => {
                    const v = parseFloat(d.value);
                    setSpeed(Number.isFinite(v) ? Math.min(2, Math.max(0.5, v)) : 1);
                  }}
                />
              </Field>
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose}>
              取消
            </Button>
            <Button appearance="primary" onClick={onGenerate}>
              生成
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
