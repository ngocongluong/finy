// Settings: enrolling the owner's voice, so only that voice can call Finy.
// Eight short recordings ("Finy ơi" five times, then three sentences) become a
// voice print: numbers describing the voice, no recording is kept.
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';
import { STRICTNESS, type Strictness } from '../lib/voicePrint';
import { beginEnrollment, endEnrollment, ENROLL_STEPS, finishEnrollment, forgetVoice, getVoiceCheck, recordSample, setStrictness, useVoice } from '../lib/voice';
import { Btn, Chip, Row, Sheet, Txt, useUi } from './ui';

export function VoiceEnroll() {
  const { c } = useUi();
  const enrolled = useVoice((s) => s.enrolled);
  const [info, setInfo] = useState<{ strictness: Strictness; at: number }>({ strictness: 'normal', at: 0 });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    getVoiceCheck().then((v) => setInfo({ strictness: v.strictness, at: v.at }));
  }, [enrolled, open]);

  return (
    <View style={{ gap: 10 }}>
      <Txt v="label">Chỉ nghe giọng của bạn</Txt>
      <Txt v="small" color={enrolled ? c.positive : c.warning}>
        {enrolled
          ? `Đã đăng ký giọng của bạn${info.at ? ` (${new Date(info.at).toLocaleDateString('vi-VN')})` : ''}. Giọng khác gọi Finy sẽ không được trả lời.`
          : 'Chưa đăng ký giọng: ai gọi “Finy” cũng được trả lời.'}
      </Txt>
      {enrolled ? (
        <>
          <Txt v="small">Độ khắt khe khi so giọng</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(Object.keys(STRICTNESS) as Strictness[]).map((k) => (
              <Chip
                key={k}
                label={STRICTNESS[k].label}
                active={info.strictness === k}
                onPress={() => {
                  setInfo((i) => ({ ...i, strictness: k }));
                  setStrictness(k).catch(() => undefined);
                }}
              />
            ))}
          </View>
          <Txt v="small">Finy hay không nhận ra bạn thì chọn “Dễ”; người khác vẫn gọi được thì chọn “Khắt khe” hoặc đăng ký lại.</Txt>
        </>
      ) : null}
      <Row style={{ gap: 10 }}>
        <Btn label={enrolled ? 'Đăng ký lại' : 'Đăng ký giọng'} kind="ghost" icon="person-circle-outline" style={{ flex: 1 }} onPress={() => setOpen(true)} />
        {enrolled ? (
          <Btn
            label="Xoá"
            kind="danger"
            icon="trash-outline"
            onPress={() =>
              Alert.alert('Xoá giọng đã đăng ký?', 'Sau đó ai gọi “Finy” cũng được trả lời.', [
                { text: 'Không', style: 'cancel' },
                { text: 'Xoá', style: 'destructive', onPress: () => forgetVoice() },
              ])
            }
          />
        ) : null}
      </Row>
      <EnrollSheet visible={open} onClose={() => setOpen(false)} />
    </View>
  );
}

/** The eight recordings, one after another. */
function EnrollSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { c } = useUi();
  const [step, setStep] = useState(0);
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [done, setDone] = useState(false);
  const samples = useRef<{ wake: number[][]; sentences: number[][] }>({ wake: [], sentences: [] });
  const alive = useRef(false);

  useEffect(() => {
    if (!visible) return;
    alive.current = true;
    samples.current = { wake: [], sentences: [] };
    setStep(0);
    setDone(false);
    setRecording(false);
    setMessage(null);
    beginEnrollment().then((err) => {
      if (err) setMessage({ text: err, error: true });
    });
    return () => {
      alive.current = false;
      endEnrollment();
    };
  }, [visible]);

  // Records from `from` on; after a good sample the next one starts by itself.
  const run = async (from: number) => {
    let i = from;
    while (alive.current && i < ENROLL_STEPS.length) {
      setStep(i);
      setRecording(true);
      const r = await recordSample(ENROLL_STEPS[i].kind);
      if (!alive.current) return;
      setRecording(false);
      if (!r.embedding) {
        setMessage({ text: r.problem ?? 'Nói lại nhé.', error: true });
        return;
      }
      (ENROLL_STEPS[i].kind === 'wake' ? samples.current.wake : samples.current.sentences).push(r.embedding);
      setMessage({ text: 'Tốt lắm!', error: false });
      i++;
    }
    if (!alive.current) return;
    const ok = await finishEnrollment(samples.current.wake, samples.current.sentences);
    setDone(true);
    setMessage(ok ? { text: 'Xong! Từ giờ chỉ giọng của bạn gọi được Finy.', error: false } : { text: 'Chưa đủ mẫu, đăng ký lại nhé.', error: true });
  };

  const current = ENROLL_STEPS[Math.min(step, ENROLL_STEPS.length - 1)];
  return (
    <Sheet visible={visible} onClose={onClose} title="Đăng ký giọng của bạn" footer={done ? <Btn label="Xong" icon="checkmark" onPress={onClose} /> : undefined}>
      <Txt v="small">
        Ở chỗ yên tĩnh, cầm máy như khi gọi Finy và nói tự nhiên. Finy chỉ giữ lại các con số mô tả giọng bạn, không lưu bản ghi âm nào.
      </Txt>
      {!done ? (
        <View style={{ gap: 14, alignItems: 'center', paddingVertical: 8 }}>
          <Txt v="small">
            Bước {step + 1}/{ENROLL_STEPS.length}
          </Txt>
          <Txt v="title" style={{ textAlign: 'center' }}>
            “{current.say}”
          </Txt>
          {recording ? (
            <Row style={{ gap: 10 }}>
              <ActivityIndicator color={c.accent} />
              <Txt color={c.accent}>Đang nghe… nói đi</Txt>
            </Row>
          ) : (
            <Btn label={step === 0 && !message ? 'Bắt đầu' : 'Nói lại'} icon="mic" onPress={() => run(step)} />
          )}
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {ENROLL_STEPS.map((_, i) => (
              <View key={i} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: i < step || (done && i === step) ? c.positive : i === step ? c.accent : c.border }} />
            ))}
          </View>
        </View>
      ) : (
        <Row style={{ gap: 10, justifyContent: 'center', paddingVertical: 8 }}>
          <Ionicons name={message?.error ? 'alert-circle' : 'checkmark-circle'} size={28} color={message?.error ? c.negative : c.positive} />
        </Row>
      )}
      {message ? (
        <Txt v="small" color={message.error ? c.negative : c.positive} style={{ textAlign: 'center' }}>
          {message.text}
        </Txt>
      ) : null}
    </Sheet>
  );
}
