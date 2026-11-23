import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, TextInput, View } from 'react-native';
import { NumberSheet, Toggle } from '../components/sheets';
import { Btn, Card, Chip, Field, IconBtn, Row, Screen, Segmented, Sheet, Txt, useUi } from '../components/ui';
import { apiKey, testKey } from '../lib/claude';
import { fmtVND } from '../lib/format';
import * as gmail from '../lib/gmail';
import { creditOverMessage, shouldAlertCreditOver, syncHsbc } from '../lib/hsbc';
import { withoutAutoLock } from '../lib/lockGuard';
import { biometricAvailable, getBiometricPref, PIN_LENGTH, setBiometricPref, setPin, verifyPin } from '../lib/security';
import { useStore } from '../lib/store';
import { alpha } from '../lib/theme';

const LOCK_OPTIONS = [
  { value: 0, label: 'Ngay lập tức' },
  { value: 30, label: '30 giây' },
  { value: 120, label: '2 phút' },
];

function PinInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const { c, r, fs } = useUi();
  return (
    <View style={{ gap: 6 }}>
      <Txt v="label">{label}</Txt>
      <TextInput
        value={value}
        onChangeText={(t) => onChange(t.replace(/\D/g, '').slice(0, PIN_LENGTH))}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={PIN_LENGTH}
        placeholder="••••••"
        placeholderTextColor={alpha(c.muted, 0.5)}
        style={{ backgroundColor: c.cardAlt, color: c.text, borderRadius: Math.min(r, 14), paddingHorizontal: 14, fontSize: fs(20), minHeight: 52, letterSpacing: 6 }}
      />
    </View>
  );
}

export default function Settings() {
  const { c } = useUi();
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const ui = useStore((s) => s.ui);
  const canUndo = useStore((s) => s.uiHistory.length > 0);

  const [bioAvail, setBioAvail] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [newPin2, setNewPin2] = useState('');
  const [pinMsg, setPinMsg] = useState<string | null>(null);
  const [gmailBusy, setGmailBusy] = useState(false);
  const [gmailMsg, setGmailMsg] = useState<string | null>(null);
  const [gmailError, setGmailError] = useState(true);
  const [dayOpen, setDayOpen] = useState(false);
  const [query, setQuery] = useState(settings.gmailQuery);
  const [keyText, setKeyText] = useState('');
  const [keyMsg, setKeyMsg] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const [bioOn, setBioOn] = useState(true);

  useEffect(() => {
    biometricAvailable().then(setBioAvail);
    getBiometricPref().then(setBioOn);
  }, []);

  const changePin = async () => {
    if (newPin.length !== PIN_LENGTH || newPin !== newPin2) {
      setPinMsg(`Mã PIN mới phải đủ ${PIN_LENGTH} số và nhập lại trùng khớp.`);
      return;
    }
    const res = await verifyPin(oldPin);
    if (!res.ok) {
      setPinMsg(res.waitSec > 0 ? `Sai quá nhiều lần. Thử lại sau ${res.waitSec} giây.` : 'Mã PIN hiện tại không đúng.');
      return;
    }
    await setPin(newPin);
    setPinOpen(false);
    Alert.alert('Đã đổi mã PIN');
  };

  const connectGmail = async () => {
    setGmailBusy(true);
    setGmailMsg(null);
    try {
      const email = await withoutAutoLock(() => gmail.connect());
      setSettings({ gmailEmail: email });
      // Bring the transactions in straight away.
      setGmailMsg('Đã kết nối. Đang lấy giao dịch HSBC…');
      const r = await syncHsbc();
      setGmailMsg(r.scanned === 0 ? 'Đã kết nối. Chưa thấy email HSBC nào khớp bộ lọc.' : `Đã kết nối và thêm ${r.imported} giao dịch từ ${r.scanned} email HSBC.`);
      setGmailError(false);
      if (r.creditOver && (await shouldAlertCreditOver(r.creditOver))) Alert.alert('Chi tín dụng vượt dự chi', creditOverMessage(r.creditOver, fmtVND));
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setGmailError(true);
      setGmailMsg(
        /DEVELOPER_ERROR|10:/.test(m)
          ? 'Google chưa nhận app này (DEVELOPER_ERROR): project Google của Finy chưa có OAuth client cho com.finy.app. Bật đăng nhập Google trong Firebase Console của project rồi thử lại — xem README, mục Gmail.'
          : m,
      );
    } finally {
      setGmailBusy(false);
    }
  };

  // Opened through finy://settings?gmail=connect : start the Google sign-in as soon as the app is unlocked.
  const params = useLocalSearchParams<{ gmail?: string }>();
  const phase = useStore((s) => s.phase);
  const autoConnect = useRef(false);
  useEffect(() => {
    if (params.gmail !== 'connect' || phase !== 'ready' || autoConnect.current) return;
    autoConnect.current = true;
    if (!useStore.getState().settings.gmailEmail) connectGmail();
    // connectGmail is recreated every render; this must run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.gmail, phase]);

  const disconnectGmail = async () => {
    setGmailBusy(true);
    try {
      await gmail.disconnect();
      setSettings({ gmailEmail: null });
    } finally {
      setGmailBusy(false);
    }
  };

  const wipe = () => {
    Alert.alert('Xoá toàn bộ dữ liệu?', 'Ngân sách, tài khoản, giao dịch, kế hoạch và trò chuyện sẽ bị xoá vĩnh viễn khỏi máy này.', [
      { text: 'Không', style: 'cancel' },
      {
        text: 'Xoá hết',
        style: 'destructive',
        onPress: () =>
          Alert.alert('Chắc chắn?', 'Không thể khôi phục sau khi xoá.', [
            { text: 'Không', style: 'cancel' },
            { text: 'Xoá vĩnh viễn', style: 'destructive', onPress: () => useStore.getState().wipe() },
          ]),
      },
    ]);
  };

  const embedded = !settings.apiKeyOverride && !!apiKey();

  return (
    <Screen title="Cài đặt" right={<IconBtn name="close" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} label="Đóng" />}>
      <Card style={{ gap: 14 }}>
        <Txt v="heading">Bảo mật</Txt>
        <Toggle
          label="Mở khoá bằng vân tay"
          hint={bioAvail ? undefined : 'Máy chưa cài vân tay hoặc khuôn mặt.'}
          value={bioOn && bioAvail}
          onChange={(v) => {
            if (!bioAvail) return;
            setBioOn(v);
            setBiometricPref(v);
          }}
        />
        <Toggle label="Ẩn số tiền khi mở app" hint="Bấm biểu tượng con mắt ở Tổng quan để hiện lại." value={settings.hideAmountsOnOpen} onChange={(v) => setSettings({ hideAmountsOnOpen: v })} />
        <View style={{ gap: 8 }}>
          <Txt v="label">Tự khoá khi rời app</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {LOCK_OPTIONS.map((o) => (
              <Chip key={o.value} label={o.label} active={settings.autoLockSec === o.value} onPress={() => setSettings({ autoLockSec: o.value })} />
            ))}
          </View>
        </View>
        <Row style={{ gap: 10 }}>
          <Btn label="Đổi mã PIN" kind="ghost" icon="key-outline" style={{ flex: 1 }} onPress={() => { setOldPin(''); setNewPin(''); setNewPin2(''); setPinMsg(null); setPinOpen(true); }} />
          <Btn label="Khoá ngay" kind="ghost" icon="lock-closed-outline" style={{ flex: 1 }} onPress={() => useStore.getState().lock()} />
        </Row>
        <Txt v="small">Dữ liệu được mã hoá trên máy (SQLCipher, khoá nằm trong Android Keystore). App chặn chụp màn hình và ẩn nội dung ở màn hình đa nhiệm.</Txt>
      </Card>

      <Card style={{ gap: 12 }}>
        <Row>
          <Txt v="heading">Gmail · giao dịch HSBC</Txt>
          {gmailBusy ? <ActivityIndicator color={c.accent} /> : null}
        </Row>
        <Txt v="label">{settings.gmailEmail ? `Đã kết nối: ${settings.gmailEmail}` : 'Chưa kết nối. Finy chỉ xin quyền đọc thư.'}</Txt>
        {settings.gmailEmail ? (
          <Btn label="Ngắt kết nối Gmail" kind="danger" icon="log-out-outline" onPress={disconnectGmail} disabled={gmailBusy} />
        ) : (
          <Btn label="Kết nối Gmail" icon="mail-outline" onPress={connectGmail} disabled={gmailBusy} />
        )}
        {gmailMsg ? <Txt v="small" color={gmailError ? c.negative : c.muted}>{gmailMsg}</Txt> : null}
        <Row>
          <View style={{ flex: 1, marginRight: 12 }}>
            <Txt>Ngày sao kê thẻ tín dụng</Txt>
            <Txt v="small">Kỳ tín dụng chốt vào ngày này mỗi tháng.</Txt>
          </View>
          <Btn label={`Ngày ${settings.statementDay}`} kind="ghost" style={{ minHeight: 42 }} onPress={() => setDayOpen(true)} />
        </Row>
        <Field label="Bộ lọc tìm email (cú pháp tìm kiếm của Gmail)" value={query} onChangeText={setQuery} />
        {query.trim() !== settings.gmailQuery ? <Btn label="Lưu bộ lọc" kind="ghost" onPress={() => setSettings({ gmailQuery: query.trim() })} disabled={!query.trim()} /> : null}
        <Txt v="small">Chỉ email gửi từ hsbc.com.vn hoặc hsbc.com mới được đọc. Email báo giao dịch thẻ tín dụng được đọc ngay trên máy; chỉ email HSBC có định dạng khác mới được gửi tới Claude để tách số tiền và nơi giao dịch.</Txt>
      </Card>

      <Card style={{ gap: 12 }}>
        <Txt v="heading">Claude</Txt>
        <Txt v="label">
          {settings.apiKeyOverride ? 'Đang dùng key bạn nhập trong app.' : embedded ? 'Đang dùng key được đóng gói sẵn trong app.' : 'Chưa có key. Nhập key bên dưới.'}
        </Txt>
        <Row style={{ gap: 10 }}>
          <Btn
            label={testing ? 'Đang thử…' : 'Thử kết nối'}
            kind="ghost"
            icon="pulse-outline"
            style={{ flex: 1 }}
            disabled={testing}
            onPress={async () => {
              setTesting(true);
              setKeyMsg(await testKey());
              setTesting(false);
            }}
          />
        </Row>
        {keyMsg ? <Txt v="small">{keyMsg}</Txt> : null}
        <Field label="Dùng key khác (tuỳ chọn)" value={keyText} onChangeText={setKeyText} placeholder="sk-ant-…" secure />
        <Row style={{ gap: 10 }}>
          <Btn label="Lưu key" kind="ghost" style={{ flex: 1 }} disabled={!keyText.trim()} onPress={() => { setSettings({ apiKeyOverride: keyText.trim() }); setKeyText(''); setKeyMsg(null); }} />
          {settings.apiKeyOverride ? <Btn label="Dùng lại key gốc" kind="ghost" style={{ flex: 1 }} onPress={() => { setSettings({ apiKeyOverride: null }); setKeyMsg(null); }} /> : null}
        </Row>
      </Card>

      <Card style={{ gap: 12 }}>
        <Txt v="heading">Giao diện</Txt>
        <Txt v="label">Muốn đổi màu, cỡ chữ, bố cục trang Tổng quan? Nhắn cho Finy ở tab Finy.</Txt>
        <View style={{ gap: 8 }}>
          <Txt v="label">Cách hiện số tiền</Txt>
          <Segmented
            value={ui.amountFormat}
            onChange={(v) => useStore.getState().patchUi({ amountFormat: v })}
            options={[{ value: 'full', label: '20.000.000 đ' }, { value: 'compact', label: '20 tr' }]}
          />
        </View>
        <Row style={{ gap: 10 }}>
          <Btn label="Hoàn tác" kind="ghost" icon="arrow-undo-outline" style={{ flex: 1 }} disabled={!canUndo} onPress={() => useStore.getState().undoUi()} />
          <Btn label="Về mặc định" kind="ghost" icon="refresh-outline" style={{ flex: 1 }} onPress={() => useStore.getState().resetUi()} />
        </Row>
      </Card>

      <Card style={{ gap: 12 }}>
        <Txt v="heading">Dữ liệu</Txt>
        <Btn label="Xoá toàn bộ dữ liệu" kind="danger" icon="trash-outline" onPress={wipe} />
      </Card>

      <NumberSheet
        visible={dayOpen}
        onClose={() => setDayOpen(false)}
        title="Ngày sao kê thẻ tín dụng"
        label="Ngày trong tháng (1–28)"
        hint="Ví dụ 14: kỳ sao kê tháng 12 gồm các giao dịch từ 15/11 đến 14/12."
        money={false}
        value={settings.statementDay}
        onSave={(n) => {
          if (n !== null && n >= 1 && n <= 28) setSettings({ statementDay: Math.round(n) });
          else Alert.alert('Ngày không hợp lệ', 'Nhập một ngày từ 1 đến 28.');
        }}
      />
      <Sheet
        visible={pinOpen}
        onClose={() => setPinOpen(false)}
        title="Đổi mã PIN"
        footer={<Btn label="Đổi mã PIN" icon="checkmark" onPress={changePin} disabled={oldPin.length !== PIN_LENGTH} />}>
        <PinInput label="Mã PIN hiện tại" value={oldPin} onChange={setOldPin} />
        <PinInput label="Mã PIN mới" value={newPin} onChange={setNewPin} />
        <PinInput label="Nhập lại mã PIN mới" value={newPin2} onChange={setNewPin2} />
        {pinMsg ? <Txt v="small" color={c.negative}>{pinMsg}</Txt> : null}
      </Sheet>
    </Screen>
  );
}
