/**
 * HomeCare Meds — Frontend Application Logic & State Engine
 * Web medication tracker for families caring for elderly relatives.
 */

import {
  signup, login, logout, watchAuthState,
  createHousehold, getHousehold, findHouseholdByInviteCode, joinHousehold,
  updateHousehold, watchHousehold,
  addPatientToHousehold, getPatientsInHousehold, updatePatient, deletePatient,
  saveDoseRecord, getDoseRecords, deleteDoseRecord, watchDoseRecords,
  addActivityLog, getRecentActivities
} from './firebase-init.js';

// ==========================================================================
// 1. DEFAULT SEED DATA & CONSTANTS
// ==========================================================================
const escapeHTML = (str) => {
  if (!str && str !== 0) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const STORAGE_KEY = 'homecare_meds_data_v2';
const BROADCAST_CHANNEL_NAME = 'homecare_meds_sync';

const TIME_SLOT_DEFS = {
  morning: { id: 'morning', name: 'มื้อเช้า', icon: '🌅', time: '08:00', hour: 8, min: 0 },
  noon: { id: 'noon', name: 'มื้อกลางวัน', icon: '☀️', time: '12:00', hour: 12, min: 0 },
  evening: { id: 'evening', name: 'มื้อเย็น', icon: '🌇', time: '18:00', hour: 18, min: 0 },
  bedtime: { id: 'bedtime', name: 'ก่อนนอน', icon: '🌙', time: '21:00', hour: 21, min: 0 }
};

const PRESET_CONDITIONS = [
  { id: 'diabetes', label: 'เบาหวาน', class: 'badge-diabetes' },
  { id: 'hypertension', label: 'ความดันโลหิตสูง', class: 'badge-hypertension' },
  { id: 'kidney', label: 'โรคไตเรื้อรัง', class: 'badge-kidney' },
  { id: 'heart', label: 'โรคหัวใจ', class: 'badge-heart' },
  { id: 'cholesterol', label: 'ไขมันในเลือดสูง', class: 'badge-cholesterol' },
  { id: 'gout', label: 'โรคเกาต์', class: 'badge-gout' }
];

const INITIAL_STATE = {
  currentUser: null,
  household: null,
  activePatientId: null,
  patients: [],
  doseRecords: {},
  activities: [],
  simulatedTime: null
};

// ==========================================================================
// 2. STATE MANAGER & PERSISTENCE
// ==========================================================================
class AppState {
  constructor() {
    this.data = this.load();
    this.broadcastChannel = null;
    this.initBroadcast();
  }

  load() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.warn('LocalStorage error:', e);
    }
    return JSON.parse(JSON.stringify(INITIAL_STATE));
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
      this.notifyBroadcast();
    } catch (e) {
      console.error('Save failed:', e);
    }
  }

  reset() {
    localStorage.removeItem(STORAGE_KEY);
    this.data = JSON.parse(JSON.stringify(INITIAL_STATE));
    this.save();
  }

  initBroadcast() {
    if ('BroadcastChannel' in window) {
      this.broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      this.broadcastChannel.onmessage = (event) => {
        if (event.data === 'sync_needed') {
          this.data = this.load();
          window.app?.renderAll();
        }
      };
    }
    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEY) {
        this.data = this.load();
        window.app?.renderAll();
      }
    });
  }

  notifyBroadcast() {
    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage('sync_needed');
    }
  }

  getActivePatient() {
    return this.data.patients.find(p => p.id === this.data.activePatientId) || this.data.patients[0];
  }

  getCurrentTime() {
    if (this.data.simulatedTime) {
      return {
        hour: this.data.simulatedTime.hour,
        min: this.data.simulatedTime.min,
        isSimulated: true
      };
    }
    const now = new Date();
    return {
      hour: now.getHours(),
      min: now.getMinutes(),
      isSimulated: false
    };
  }

  getTodayDateStr() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

// ==========================================================================
// 3. SOUND SYNTHESIZER (WEB AUDIO API)
// ==========================================================================
class SoundFx {
  static playSuccess() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      const now = ctx.currentTime;
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.setValueAtTime(659.25, now + 0.1); // E5
      osc.frequency.setValueAtTime(783.99, now + 0.2); // G5
      osc.frequency.setValueAtTime(1046.50, now + 0.3); // C6

      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

      osc.start(now);
      osc.stop(now + 0.6);
    } catch (e) {
      console.log('Audio error:', e);
    }
  }

  static playUrgentAlert() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const now = ctx.currentTime;
      
      // Two quick beep pulses
      [0, 0.25].forEach(delay => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(880, now + delay); // A5
        osc.frequency.setValueAtTime(440, now + delay + 0.1);

        osc.connect(gain);
        gain.connect(ctx.destination);

        gain.gain.setValueAtTime(0.35, now + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.2);

        osc.start(now + delay);
        osc.stop(now + delay + 0.2);
      });
    } catch (e) {
      console.log('Audio alert error:', e);
    }
  }
}

// ==========================================================================
// 4. MAIN CONTROLLER & APPLICATION ENGINE
// ==========================================================================
class HomeCareApp {
  constructor() {
    this.state = new AppState();
    
    // Dynamically set initial view based on authentication and household existence
    if (this.state.data.currentUser) {
      if (this.state.data.household) {
        this.currentView = 'caregiver';
      } else {
        this.currentView = 'onboarding';
      }
    } else {
      this.currentView = 'auth';
    }

    this.elderSelectedSlot = 'evening'; // For elder mode tab
    this.selectedPatientEmoji = '👵';
    this.selectedConditionTags = [];

    // Auth state helpers
    this.authTab = 'email'; // 'email' | 'phone'
    this.authEmailMode = 'signin'; // 'signin' | 'signup'
    this.simulatedOtpCode = '123456';
    this.simulatedPhone = '';
    this.simulatedName = '';
    this.otpTimerInterval = null;

    // Firestore realtime listeners (store so we can unsubscribe on logout)
    this._firestoreUnsubs = [];

    this.initElements();
    this.bindEvents();
    this.bindAuthEvents();
    this.initFirebaseAuthListener();
    this.renderAll();

    // Background interval check for overdue doses (every 10 seconds)
    this.statusInterval = setInterval(() => this.checkScheduleStatusAndAlerts(), 10000);

    // Repeat escalation timer — fires after repeatMinutes if still unconfirmed
    this._repeatAlertTimers = {};
    this.escalationInterval = setInterval(() => this.checkRepeatEscalation(), 30000);
  }

  initElements() {
    // Header & Navigation
    this.headerHouseholdName = document.getElementById('header-hh-name');
    this.liveTimeDisplay = document.getElementById('live-time-display');
    this.btnOpenTimeWarp = document.getElementById('btn-open-time-warp');
    this.btnModeCaregiver = document.getElementById('btn-mode-caregiver');
    this.btnModeElder = document.getElementById('btn-mode-elder');
    this.btnUserProfile = document.getElementById('btn-user-circle');
    this.userDropdown = document.getElementById('user-dropdown');
    this.userAvatarInitial = document.getElementById('user-initial');
    this.dropdownFullName = document.getElementById('udm-name');
    this.dropdownContact = document.getElementById('udm-contact');

    // Urgent escalation uses a dynamic container — no static elements to bind here

    // Views
    this.viewAuth = document.getElementById('view-auth');
    this.viewOnboarding = document.getElementById('view-onboarding');
    this.viewCreateHh = document.getElementById('view-create-hh');
    this.viewJoinHh = document.getElementById('view-join-hh');
    this.viewDashboard = document.getElementById('view-dashboard');
    this.viewElder = document.getElementById('view-elder');
    this.viewReport = document.getElementById('view-report');
    this.viewAlerts = document.getElementById('view-alerts');

    // Auth Elements
    this.tabBtnEmail = document.getElementById('tab-btn-email');
    this.tabBtnPhone = document.getElementById('tab-btn-phone');
    this.authPanelEmail = document.getElementById('auth-panel-email');
    this.authPanelPhone = document.getElementById('auth-panel-phone');
    this.btnAuthModeSignin = document.getElementById('btn-auth-mode-signin');
    this.btnAuthModeSignup = document.getElementById('btn-auth-mode-signup');
    this.groupSignupName = document.getElementById('group-signup-name');
    this.formAuthEmail = document.getElementById('form-auth-email');
    this.authInputName = document.getElementById('auth-input-name');
    this.authInputEmail = document.getElementById('auth-input-email');
    this.authInputPassword = document.getElementById('auth-input-password');
    this.btnTogglePwd = document.getElementById('btn-toggle-pwd');
    this.pwdEyeIcon = document.getElementById('pwd-eye-icon');
    this.authEmailError = document.getElementById('auth-email-error');
    this.btnSubmitEmail = document.getElementById('btn-submit-email');
    this.btnSubmitEmailText = document.getElementById('btn-submit-email-text');

    this.phoneAuthStep1 = document.getElementById('phone-auth-step-1');
    this.phoneAuthStep2 = document.getElementById('phone-auth-step-2');
    this.authInputPhone = document.getElementById('auth-input-phone');
    this.authInputPhoneName = document.getElementById('auth-input-phone-name');
    this.authPhoneError = document.getElementById('auth-phone-error');
    this.btnSendOtp = document.getElementById('btn-send-otp');
    this.smsPhoneTarget = document.getElementById('sms-phone-target');
    this.simOtpCode = document.getElementById('sim-otp-code');
    this.btnAutofillOtp = document.getElementById('btn-autofill-otp');
    this.authInputOtp = document.getElementById('auth-input-otp');
    this.authOtpError = document.getElementById('auth-otp-error');
    this.btnConfirmOtp = document.getElementById('btn-confirm-otp');
    this.otpTimerTxt = document.getElementById('otp-timer-txt');
    this.btnResendOtp = document.getElementById('btn-resend-otp');
    this.btnBackPhoneStep = document.getElementById('btn-back-phone-step');

    this.btnQuickDemo = document.getElementById('btn-quick-demo');
    this.btnBackToAuth = document.getElementById('btn-back-to-auth');

    // Caregiver Dashboard Elements
    this.patientPillsList = document.getElementById('patient-tabs-list');
    this.dashInviteCode = document.getElementById('modal-invite-code-text');
    this.curPatientAvatar = document.getElementById('cur-patient-avatar');
    this.curPatientName = document.getElementById('cur-patient-name');
    this.curPatientAge = document.getElementById('cur-patient-age');
    this.curPatientConditions = document.getElementById('cur-patient-conditions');
    this.curPatientDoctorBrief = document.getElementById('cur-patient-hosp');
    this.metricAdherence = document.getElementById('metric-adherence');
    this.metricLowStock = document.getElementById('metric-low-stock');
    this.metricActiveMembers = document.getElementById('metric-online-members');
    this.slotsTimeline = document.getElementById('slots-timeline');
    this.medsTableBody = document.getElementById('meds-table-body');
    this.totalMedsCount = document.getElementById('total-meds-count');
    this.lowStockBox = document.getElementById('low-stock-alert-box');
    this.lowStockItemsList = document.getElementById('low-stock-items-list');
    this.activityFeedList = document.getElementById('activity-feed-list');
    this.householdMembersList = document.getElementById('household-members-list');
    this.memberCountNum = document.getElementById('member-count-num');
    this.settingEscalationMinutes = document.getElementById('setting-escalation-minutes');
    this.settingRepeatMinutes = document.getElementById('setting-repeat-minutes');

    // Elder Mode Elements
    this.elderViewAvatar = document.getElementById('elder-view-avatar');
    this.elderViewName = document.getElementById('elder-view-name');
    this.elderViewDate = document.getElementById('elder-view-date');
    this.elderSlotBadge = document.getElementById('elder-slot-badge');
    this.elderSlotIcon = document.getElementById('elder-slot-icon');
    this.elderSlotTitle = document.getElementById('elder-slot-title');
    this.elderMealTiming = document.getElementById('elder-meal-timing');
    this.elderMedList = document.getElementById('elder-med-list');
    this.btnElderConfirm = document.getElementById('btn-elder-confirm');
    this.elderTakenStamp = document.getElementById('elder-taken-stamp');
    this.elderTakenTime = document.getElementById('elder-taken-time');
    this.elderSlotsNav = document.getElementById('elder-slots-nav');

    // Modals
    this.modalPatient = document.getElementById('modal-patient');
    this.modalMedication = document.getElementById('modal-medication');
    this.modalInvite = document.getElementById('modal-invite');
    this.modalTimeWarp = document.getElementById('modal-time-warp');
    this.toastContainer = document.getElementById('toast-container');
  }

  bindEvents() {
    // Mode switcher
    if (this.btnModeCaregiver) this.btnModeCaregiver.addEventListener('click', () => this.switchView('caregiver'));
    if (this.btnModeElder) this.btnModeElder.addEventListener('click', () => this.switchView('elder'));
    const btnExitElder = document.getElementById('btn-exit-elder') || document.getElementById('btn-exit-elder-mode');
    if (btnExitElder) btnExitElder.addEventListener('click', () => this.switchView('caregiver'));

    // User Profile Dropdown
    if (this.btnUserProfile && this.userDropdown) {
      this.btnUserProfile.addEventListener('click', (e) => {
        e.stopPropagation();
        this.userDropdown.classList.toggle('hidden');
      });
      document.addEventListener('click', () => {
        this.userDropdown.classList.add('hidden');
      });
    }

    // Dropdown Actions
    const btnInviteHh = document.getElementById('btn-view-invite-hh') || document.getElementById('btn-switch-household');
    if (btnInviteHh) btnInviteHh.addEventListener('click', () => this.openInviteModal());

    const btnToggleRole = document.getElementById('btn-toggle-role') || document.getElementById('btn-switch-user');
    if (btnToggleRole) btnToggleRole.addEventListener('click', () => this.toggleDemoUserRole());

    const btnResetDemo = document.getElementById('btn-reset-demo');
    if (btnResetDemo) btnResetDemo.addEventListener('click', () => {
      if (confirm('ต้องการรีเซ็ตข้อมูลตัวอย่างทั้งหมดกลับเป็นค่าเริ่มต้นหรือไม่?')) {
        this.state.reset();
        this.renderAll();
        this.showToast('รีเซ็ตข้อมูลเรียบร้อยแล้ว');
      }
    });

    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) btnLogout.addEventListener('click', () => this.handleLogout());
    if (this.btnBackToAuth) this.btnBackToAuth.addEventListener('click', () => this.handleLogout());

    // Time Warp / Simulator Controls
    if (this.btnOpenTimeWarp && this.modalTimeWarp) {
      this.btnOpenTimeWarp.addEventListener('click', () => {
        this.modalTimeWarp.classList.remove('hidden');
      });
    }
    const btnCloseTimeModal = document.getElementById('btn-close-time-modal');
    if (btnCloseTimeModal) btnCloseTimeModal.addEventListener('click', () => {
      if (this.modalTimeWarp) this.modalTimeWarp.classList.add('hidden');
    });
    
    const btnDoneTimeWarp = document.getElementById('btn-done-time-warp');
    if (btnDoneTimeWarp) btnDoneTimeWarp.addEventListener('click', () => {
      if (this.modalTimeWarp) this.modalTimeWarp.classList.add('hidden');
    });
    
    const btnResetRealTime = document.getElementById('btn-reset-real-time');
    if (btnResetRealTime) btnResetRealTime.addEventListener('click', () => {
      this.state.data.simulatedTime = null;
      this.state.save();
      if (this.modalTimeWarp) this.modalTimeWarp.classList.add('hidden');
      this.renderAll();
      this.showToast('กลับสู่เวลาจริงเรียบร้อย');
    });
    
    document.querySelectorAll('.time-warp-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const hour = parseInt(btn.getAttribute('data-hour'), 10);
        const min = parseInt(btn.getAttribute('data-min'), 10);
        this.state.data.simulatedTime = { hour, min };
        this.state.save();
        if (this.modalTimeWarp) this.modalTimeWarp.classList.add('hidden');
        this.renderAll();
        this.showToast(`ปรับเวลาจำลองเป็น ${String(hour).padStart(2,'0')}:${String(min).padStart(2,'0')} น.`);
      });
    });
    
    const btnApplyCustomTime = document.getElementById('btn-apply-custom-time');
    if (btnApplyCustomTime) btnApplyCustomTime.addEventListener('click', () => {
      const val = document.getElementById('custom-time-input')?.value;
      if (val) {
        const [h, m] = val.split(':').map(Number);
        this.state.data.simulatedTime = { hour: h, min: m };
        this.state.save();
        if (this.modalTimeWarp) this.modalTimeWarp.classList.add('hidden');
        this.renderAll();
        this.showToast(`ปรับเวลาเป็น ${val} น.`);
      }
    });

    // Onboarding & Setup Routing
    const btnGoCreate = document.getElementById('btn-go-create');
    const btnGoJoin = document.getElementById('btn-go-join');
    const btnConfirmCreate = document.getElementById('btn-confirm-create');
    const btnBackFromCreate = document.getElementById('btn-back-from-create');
    const btnConfirmJoin = document.getElementById('btn-confirm-join');
    const btnBackFromJoin = document.getElementById('btn-back-from-join');

    if (btnGoCreate) btnGoCreate.addEventListener('click', () => this.switchView('create-hh'));
    if (btnGoJoin) btnGoJoin.addEventListener('click', () => this.switchView('join-hh'));
    
    if (btnBackFromCreate) btnBackFromCreate.addEventListener('click', () => this.switchView('onboarding'));
    if (btnBackFromJoin) btnBackFromJoin.addEventListener('click', () => this.switchView('onboarding'));

    if (btnConfirmCreate) {
      btnConfirmCreate.addEventListener('click', async () => {
        const hhNameInput = document.getElementById('create-hh-name');
        const hhName = hhNameInput.value.trim() || 'บ้านครอบครัวใหม่';
        const errorEl = document.getElementById('create-hh-error');

        const myUser = this.state.data.currentUser || { id: 'usr_' + Date.now(), name: 'คุณ', role: 'แอดมินบ้าน' };
        myUser.role = 'แอดมินบ้าน';
        this.state.data.currentUser = myUser;

        const inviteCode = 'CARE-' + Math.floor(1000 + Math.random() * 9000);
        const hhData = {
          name: hhName,
          inviteCode,
          adminId: myUser.id,
          adminName: myUser.name,
          escalationMinutes: 20,
          repeatMinutes: 40
        };

        // ── Firestore: save household ──
        let hhId = 'hh_' + Date.now(); // fallback
        try {
          hhId = await createHousehold(hhData);
          console.info('[DB] Household created in Firestore:', hhId);
        } catch (e) {
          console.warn('[DB] Firestore unavailable, using local ID:', e.message);
        }

        this.state.data.household = {
          id: hhId,
          name: hhName,
          inviteCode,
          adminId: myUser.id,
          escalationMinutes: 20,
          repeatMinutes: 40,
          members: [{ id: myUser.id, name: myUser.name, role: 'แอดมินบ้าน', online: true }]
        };

        this.state.save();

        // Start Firestore real-time listeners for this household
        this.startFirestoreListeners(hhId);

        this.switchView('caregiver');
        this.showToast('สร้างบ้านใหม่เรียบร้อยแล้ว', 'success');
      });
    }

    if (btnConfirmJoin) {
      btnConfirmJoin.addEventListener('click', async () => {
        const code = document.getElementById('join-code-input').value.trim().toUpperCase();
        const errEl = document.getElementById('join-hh-error');
        if (!code) {
          if (errEl) errEl.classList.remove('hidden');
          return;
        }
        if (errEl) errEl.classList.add('hidden');

        const myUser = this.state.data.currentUser || { id: 'usr_' + Date.now(), name: 'คุณ', role: 'สมาชิก' };
        myUser.role = 'สมาชิก';
        this.state.data.currentUser = myUser;

        // ── Firestore: look up household by invite code ──
        let hhObj = null;
        try {
          hhObj = await findHouseholdByInviteCode(code);
          if (hhObj) {
            await joinHousehold(hhObj.id, { id: myUser.id, name: myUser.name, role: 'สมาชิก' }, code);
            console.info('[DB] Joined household in Firestore:', hhObj.id);
          }
        } catch (e) {
          console.warn('[DB] Firestore join error, using local fallback:', e.message);
        }

        if (!hhObj) {
          // Fallback: local mock if Firestore unavailable or code not found
          hhObj = {
            id: 'hh_join_' + Date.now(),
            name: 'บ้านคุณย่าใจดี',
            inviteCode: code,
            adminId: 'usr_x',
            escalationMinutes: 20,
            repeatMinutes: 40,
            members: [
              { id: 'usr_x', name: 'แอดมินบ้าน', role: 'แอดมินบ้าน', online: false },
              { id: myUser.id, name: myUser.name, role: 'สมาชิก', online: true }
            ]
          };
          if (errEl) {
            errEl.textContent = 'ไม่พบรหัสนี้ใน Firestore — ใช้ข้อมูลตัวอย่างแทน';
            errEl.classList.remove('hidden');
          }
        }

        this.state.data.household = hhObj;
        this.state.save();

        // Start Firestore real-time listeners for this household
        this.startFirestoreListeners(hhObj.id);

        this.switchView('caregiver');
        this.showToast('เข้าร่วมบ้านเรียบร้อยแล้ว', 'success');
      });
    }

    // Patient Modals & Actions
    const _el_btn_open_add_patient_modal = document.getElementById('btn-open-add-patient-modal');
    if (_el_btn_open_add_patient_modal) _el_btn_open_add_patient_modal.addEventListener('click', () => {
      this.openAddPatientModal();
    });
    
    // Add patient from empty state / sidebar shortcut
    ['btn-empty-add-patient', 'btn-side-add-patient'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', () => this.openAddPatientModal());
    });

    // Bottom nav — "แจ้งเตือน" tab opens the weekly alerts history page
    const _el_nav_alerts = document.getElementById('nav-alerts');
    if (_el_nav_alerts) _el_nav_alerts.addEventListener('click', () => {
      document.querySelectorAll('.bottom-nav .nav-tab').forEach(t => t.classList.remove('active'));
      _el_nav_alerts.classList.add('active');
      this.switchView('alerts');
    });

    const _el_btn_back_from_alerts = document.getElementById('btn-back-from-alerts');
    if (_el_btn_back_from_alerts) _el_btn_back_from_alerts.addEventListener('click', () => {
      document.querySelectorAll('.bottom-nav .nav-tab').forEach(t => t.classList.remove('active'));
      const homeTab = document.getElementById('nav-home');
      if (homeTab) homeTab.classList.add('active');
      this.switchView('caregiver');
    });
    const _el_btn_edit_patient = document.getElementById('btn-edit-patient');
    if (_el_btn_edit_patient) _el_btn_edit_patient.addEventListener('click', () => {
      this.openEditPatientModal();
    });
    const _el_btn_close_patient_modal = document.getElementById('btn-close-patient-modal');
    if (_el_btn_close_patient_modal) _el_btn_close_patient_modal.addEventListener('click', () => {
      this.modalPatient.classList.add('hidden');
    });
    const _el_btn_cancel_patient = document.getElementById('btn-cancel-patient');
    if (_el_btn_cancel_patient) _el_btn_cancel_patient.addEventListener('click', () => {
      this.modalPatient.classList.add('hidden');
    });
    const _el_form_patient = document.getElementById('form-patient');
    if (_el_form_patient) _el_form_patient.addEventListener('submit', (e) => {
      e.preventDefault();
      this.savePatientForm();
    });

    // Emoji Picker for Patient
    document.querySelectorAll('.emoji-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.emoji-opt').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.selectedPatientEmoji = btn.getAttribute('data-emoji');
      });
    });

    // Custom condition tag button
    const _el_btn_add_custom_tag = document.getElementById('btn-add-custom-tag');
    if (_el_btn_add_custom_tag) _el_btn_add_custom_tag.addEventListener('click', () => {
      const input = document.getElementById('custom-condition-input');
      const val = input.value.trim();
      if (val) {
        this.selectedConditionTags.push({ id: 'tag_' + Date.now(), label: val, class: 'badge-custom' });
        input.value = '';
        this.renderSelectedTagsPreview();
      }
    });

    // Medication Modal & Actions — bind ALL add-med button IDs
    ['btn-open-add-med-modal', 'btn-open-add-med', 'btn-top-add-med'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', () => this.openAddMedModal());
    });

    const _el_btn_close_med_modal = document.getElementById('btn-close-med-modal');
    if (_el_btn_close_med_modal) _el_btn_close_med_modal.addEventListener('click', () => {
      this.modalMedication.classList.add('hidden');
    });
    const _el_btn_cancel_med = document.getElementById('btn-cancel-med');
    if (_el_btn_cancel_med) _el_btn_cancel_med.addEventListener('click', () => {
      this.modalMedication.classList.add('hidden');
    });
    const _el_med_duration_type = document.getElementById('med-duration-type');
    if (_el_med_duration_type) _el_med_duration_type.addEventListener('change', (e) => {
      const isTemp = e.target.value === 'temporary';
      document.getElementById('temp-date-group').classList.toggle('hidden', !isTemp);
    });
    const _el_form_medication = document.getElementById('form-medication');
    if (_el_form_medication) _el_form_medication.addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveMedicationForm();
    });

    // Invite Modal Actions
    const _el_btn_view_invite = document.getElementById('btn-view-invite');
    if (_el_btn_view_invite) _el_btn_view_invite.addEventListener('click', () => this.openInviteModal());
    const _el_btn_side_invite_member = document.getElementById('btn-side-invite-member');
    if (_el_btn_side_invite_member) _el_btn_side_invite_member.addEventListener('click', () => this.openInviteModal());
    const _el_btn_close_invite_modal = document.getElementById('btn-close-invite-modal');
    if (_el_btn_close_invite_modal) _el_btn_close_invite_modal.addEventListener('click', () => {
      this.modalInvite.classList.add('hidden');
    });
    const _el_btn_copy_invite_link = document.getElementById('btn-copy-invite-link');
    if (_el_btn_copy_invite_link) _el_btn_copy_invite_link.addEventListener('click', () => {
      const code = this.state.data.household.inviteCode;
      const text = `ขอเชิญเข้าร่วมดูแลยาของ ${this.state.data.household.name} ผ่าน HomeCare Meds ด้วยรหัส: ${code}`;
      navigator.clipboard?.writeText(text);
      this.showToast('คัดลอกข้อความและรหัสเชิญเรียบร้อยแล้ว!', 'success');
    });
    const _el_btn_simulate_member_join = document.getElementById('btn-simulate-member-join');
    if (_el_btn_simulate_member_join) _el_btn_simulate_member_join.addEventListener('click', () => {
      const relatives = ['พี่มานพ (ลูกชายคนกลาง)', 'ป้าสมใจ (น้องสาว)', 'พยาบาลแนน (ผู้ดูแล)'];
      const pick = relatives[Math.floor(Math.random() * relatives.length)];
      this.state.data.household.members.push({
        id: 'usr_' + Date.now(),
        name: pick,
        relation: 'สมาชิกครอบครัว',
        role: 'สมาชิก',
        online: true
      });
      this.addActivity(`${pick} เข้าร่วมบ้านผ่านรหัสเชิญเรียบร้อยแล้ว`);
      this.state.save();
      this.renderAll();
      this.showToast(`${pick} เข้าร่วมบ้านสำเร็จ!`);
      this.modalInvite.classList.add('hidden');
    });

    // Report View Actions
    const _el_btn_open_report_view = document.getElementById('btn-open-report-view');
    if (_el_btn_open_report_view) _el_btn_open_report_view.addEventListener('click', () => {
      this.switchView('report');
    });
    const _el_btn_back_from_report = document.getElementById('btn-back-from-report');
    if (_el_btn_back_from_report) _el_btn_back_from_report.addEventListener('click', () => {
      this.switchView('caregiver');
    });

    // Escalation Settings Change
    this.settingEscalationMinutes.addEventListener('change', (e) => {
      this.state.data.household.escalationMinutes = parseInt(e.target.value, 10);
      this.state.save();
      this.showToast(`บันทึกเวลาเตือนด่วน: ${e.target.value} นาที`);
    });
    this.settingRepeatMinutes.addEventListener('change', (e) => {
      this.state.data.household.repeatMinutes = parseInt(e.target.value, 10);
      this.state.save();
      this.showToast(`บันทึกเวลาเตือนซ้ำ: ${e.target.value} นาที`);
    });

    // Elder Big Take Button
    this.btnElderConfirm.addEventListener('click', () => {
      this.confirmDose(this.elderSelectedSlot, 'elder');
    });
  }

  // ==========================================================================
  // VIEW SWITCHING
  // ==========================================================================
  switchView(viewName) {
    this.currentView = viewName;
    [this.viewAuth, this.viewOnboarding, this.viewCreateHh, this.viewJoinHh, this.viewDashboard, this.viewElder, this.viewReport, this.viewAlerts]
      .forEach(v => { if (v) v.classList.add('hidden'); });

    if (this.btnModeCaregiver) this.btnModeCaregiver.classList.toggle('active', viewName === 'caregiver');
    if (this.btnModeElder) this.btnModeElder.classList.toggle('active', viewName === 'elder');

    if (viewName === 'auth') {
      if (this.viewAuth) this.viewAuth.classList.remove('hidden');
    } else if (viewName === 'onboarding') {
      if (this.viewOnboarding) this.viewOnboarding.classList.remove('hidden');
    } else if (viewName === 'create-hh') {
      if (this.viewCreateHh) this.viewCreateHh.classList.remove('hidden');
    } else if (viewName === 'join-hh') {
      if (this.viewJoinHh) this.viewJoinHh.classList.remove('hidden');
    } else if (viewName === 'elder') {
      if (this.viewElder) this.viewElder.classList.remove('hidden');
      this.renderElderMode();
    } else if (viewName === 'report') {
      if (this.viewReport) this.viewReport.classList.remove('hidden');
      this.renderDoctorReport();
    } else if (viewName === 'alerts') {
      if (this.viewAlerts) this.viewAlerts.classList.remove('hidden');
      this.renderAlertsHistory();
    } else {
      if (this.viewDashboard) this.viewDashboard.classList.remove('hidden');
      this.renderCaregiverDashboard();
    }
    this.refreshIcons();
  }

  // ==========================================================================
  // RENDER ALL
  // ==========================================================================
  renderAll() {
    this.renderHeader();
    this.checkScheduleStatusAndAlerts();

    if (this.currentView === 'caregiver') {
      this.renderCaregiverDashboard();
    } else if (this.currentView === 'elder') {
      this.renderElderMode();
    } else if (this.currentView === 'report') {
      this.renderDoctorReport();
    }

    this.refreshIcons();
  }

  renderHeader() {
    const user = this.state.data.currentUser;
    const hh = this.state.data.household;
    const time = this.state.getCurrentTime();

    if (hh) {
      if (this.headerHouseholdName) this.headerHouseholdName.textContent = hh.name;
      if (this.settingEscalationMinutes) this.settingEscalationMinutes.value = String(hh.escalationMinutes || 20);
      if (this.settingRepeatMinutes) this.settingRepeatMinutes.value = String(hh.repeatMinutes || 40);
    }
    
    if (user) {
      if (this.userAvatarInitial) this.userAvatarInitial.textContent = user.name.charAt(0);
      if (this.dropdownFullName) this.dropdownFullName.textContent = `${user.name} (${user.role || user.relation || ''})`;
      if (this.dropdownContact) this.dropdownContact.textContent = user.phone || user.email || '';
    }

    const timeStr = `${String(time.hour).padStart(2, '0')}:${String(time.min).padStart(2, '0')} น.`;
    if (this.liveTimeDisplay) this.liveTimeDisplay.textContent = timeStr + (time.isSimulated ? ' (จำลอง)' : '');
  }

  // ==========================================================================
  // CAREGIVER DASHBOARD RENDERING
  // ==========================================================================
  renderCaregiverDashboard() {
    const patient = this.state.getActivePatient();

    // ✅ FIX: Show/hide empty state vs caregiver content
    const emptyState = document.getElementById('empty-state-patients');
    const caregiverContent = document.getElementById('caregiver-content');

    if (!patient || this.state.data.patients.length === 0) {
      if (emptyState) emptyState.classList.remove('hidden');
      if (caregiverContent) caregiverContent.classList.add('hidden');
      return;
    }

    if (emptyState) emptyState.classList.add('hidden');
    if (caregiverContent) caregiverContent.classList.remove('hidden');

    if (this.dashInviteCode) this.dashInviteCode.textContent = this.state.data.household.inviteCode;

    // 1. Patient Selector Pills
    if (this.patientPillsList) {
      this.patientPillsList.innerHTML = this.state.data.patients.map(p => `
        <button class="patient-pill-btn ${p.id === patient.id ? 'active' : ''}" data-patient-id="${p.id}">
          <span>${escapeHTML(p.avatar)}</span>
          <span>${escapeHTML(p.name)}</span>
        </button>
      `).join('') + `
        <button class="patient-pill-btn" id="btn-top-add-patient-pill" style="border: 2px dashed var(--border); background: transparent;">
          <i data-lucide="plus" style="width:16px;height:16px;"></i> เพิ่มผู้ป่วย
        </button>
      `;

      this.patientPillsList.querySelectorAll('.patient-pill-btn[data-patient-id]').forEach(btn => {
        btn.addEventListener('click', () => {
          this.state.data.activePatientId = btn.getAttribute('data-patient-id');
          this.state.save();
          this.renderAll();
        });
      });

      const btnTopAddPatient = document.getElementById('btn-top-add-patient-pill');
      if (btnTopAddPatient) {
        btnTopAddPatient.addEventListener('click', () => this.openAddPatientModal());
      }
    }

    // 2. Patient Profile Banner
    if (this.curPatientAvatar) this.curPatientAvatar.textContent = patient.avatar;
    if (this.curPatientName) this.curPatientName.textContent = patient.name;
    if (this.curPatientAge) this.curPatientAge.textContent = `อายุ ${patient.age} ปี (${patient.gender})`;

    if (this.curPatientConditions) {
      this.curPatientConditions.innerHTML = patient.conditions.map(c => `
        <span class="condition-badge ${escapeHTML(c.class) || 'badge-custom'}">
          <i data-lucide="tag"></i> ${escapeHTML(c.label)}
        </span>
      `).join('');
    }

    if (this.curPatientDoctorBrief) {
      this.curPatientDoctorBrief.innerHTML = `
        <span><i data-lucide="stethoscope"></i> ${escapeHTML(patient.hospital) || 'รพ.ประจำตัว'} • ${escapeHTML(patient.doctor) || 'แพทย์เจ้าของไข้'}</span>
      `;
    }

    // 3. Quick Metrics
    const adherence = this.calculateAdherenceRate(patient);
    if (this.metricAdherence) this.metricAdherence.textContent = `${adherence}%`;

    const lowStockMeds = this.getLowStockMeds(patient);
    if (this.metricLowStock) this.metricLowStock.textContent = `${lowStockMeds.length} ตัว`;

    const activeCount = this.state.data.household.members.filter(m => m.online).length;
    if (this.metricActiveMembers) this.metricActiveMembers.textContent = `${activeCount} คน`;

    // 4. Daily Schedule Timeline
    this.renderDailySchedule(patient);

    // 5. Medications Catalog Table
    this.renderMedsCatalog(patient);

    // 6. Side Column: Low Stock, Activity Feed, Household Members
    this.renderSideColumn(patient, lowStockMeds);
  }

  renderDailySchedule(patient) {
    const today = this.state.getTodayDateStr();
    const time = this.state.getCurrentTime();
    const currentTotalMins = time.hour * 60 + time.min;

    let slotsHtml = '';

    Object.values(TIME_SLOT_DEFS).forEach(slot => {
      const medsInSlot = patient.medications.filter(m => m.slots && m.slots.includes(slot.id));
      if (medsInSlot.length === 0) return;

      const recordKey = `${patient.id}_${today}_${slot.id}`;
      const record = this.state.data.doseRecords[recordKey];
      const isTaken = record && record.status === 'taken';

      const slotTotalMins = slot.hour * 60 + slot.min;
      const diffMins = currentTotalMins - slotTotalMins;

      let statusClass = 'slot-card';
      let statusPillHtml = '';
      let actionFooterHtml = '';

      if (isTaken) {
        statusClass += ' slot-taken';
        statusPillHtml = `<span class="slot-status-pill status-pill-taken"><i data-lucide="check"></i> ทานแล้ว (${record.takenAt} น.)</span>`;
        actionFooterHtml = `
          <div class="slot-taken-log-info">
            <i data-lucide="check-circle-2"></i> บันทึกโดย: ${escapeHTML(record.confirmedBy)}
            ${this.state.data.currentUser.role === 'แอดมินบ้าน' ? `<button class="btn-undo-confirm" data-slot="${slot.id}" data-patient="${patient.id}">ย้อนสถานะ</button>` : ''}
          </div>
        `;
      } else if (diffMins >= (this.state.data.household?.escalationMinutes || 20)) {
        statusClass += ' slot-overdue';
        statusPillHtml = `<span class="slot-status-pill status-pill-overdue"><i data-lucide="alert-circle"></i> เลยเวลา ${diffMins} นาที</span>`;
        actionFooterHtml = `
          <div class="urgent-actions-row">
            <button class="btn-confirm-for-elder" data-slot="${slot.id}" data-patient="${patient.id}">
              <i data-lucide="check-circle"></i> ยืนยันแทนว่ากินแล้ว
            </button>
          </div>
        `;
      } else if (diffMins >= 0) {
        statusClass += ' slot-due-now';
        statusPillHtml = `<span class="slot-status-pill status-pill-due"><i data-lucide="clock"></i> ถึงเวลาทานยา</span>`;
        actionFooterHtml = `
          <button class="btn-confirm-for-elder" data-slot="${slot.id}" data-patient="${patient.id}">
            <i data-lucide="check-circle"></i> ยืนยันแทนว่ากินแล้ว
          </button>
        `;
      } else {
        statusPillHtml = `<span class="slot-status-pill status-pill-upcoming">รอถึงเวลา</span>`;
        actionFooterHtml = `
          <button class="btn-confirm-for-elder" data-slot="${slot.id}" data-patient="${patient.id}">
            <i data-lucide="check-circle"></i> บันทึกทานล่วงหน้า
          </button>
        `;
      }

      slotsHtml += `
        <div class="${statusClass}">
          <div class="slot-card-header">
            <div class="slot-title-group">
              <span class="slot-icon-box">${slot.icon}</span>
              <div>
                <span class="slot-name">${slot.name} (${slot.time} น.)</span>
                <span class="slot-time-badge">• รวม ${medsInSlot.length} รายการ</span>
              </div>
            </div>
            <div>${statusPillHtml}</div>
          </div>

          <div class="slot-med-items">
            ${medsInSlot.map(m => `
              <div class="slot-med-row">
                <div class="slot-med-info">
                  <span class="med-icon-pill">💊</span>
                  <div>
                    <span class="slot-med-name-text">${m.name}</span>
                    <span class="slot-med-meta-text"> — ${m.dosage} • ${m.mealTiming}</span>
                  </div>
                </div>
                <div>
                  <span class="condition-badge ${this.getConditionBadgeClass(m.conditionId)} slot-med-badge-tag">${m.conditionLabel}</span>
                </div>
              </div>
            `).join('')}
          </div>

          <div class="slot-card-footer">
            ${actionFooterHtml}
          </div>
        </div>
      `;
    });

    this.slotsTimeline.innerHTML = slotsHtml;

    // Bind Confirm for elder buttons
    this.slotsTimeline.querySelectorAll('.btn-confirm-for-elder').forEach(btn => {
      btn.addEventListener('click', () => {
        const slotId = btn.getAttribute('data-slot');
        const patientId = btn.getAttribute('data-patient');
        this.confirmDose(slotId, 'caregiver', patientId);
      });
    });

    // Bind Undo buttons
    this.slotsTimeline.querySelectorAll('.btn-undo-confirm').forEach(btn => {
      btn.addEventListener('click', () => {
        const slotId = btn.getAttribute('data-slot');
        const patientId = btn.getAttribute('data-patient');
        this.undoDose(slotId, patientId);
      });
    });
  }

  renderMedsCatalog(patient) {
    this.totalMedsCount.textContent = patient.medications.length;
    this.medsTableBody.innerHTML = patient.medications.map(m => {
      const slotNames = (m.slots || []).map(s => TIME_SLOT_DEFS[s]?.name || s).join(', ');
      const isLowStock = (m.stockCount || 0) <= 10;
      return `
        <tr>
          <td>
            <strong>💊 ${escapeHTML(m.name)}</strong><br>
            <small class="text-muted">${escapeHTML(m.dosage)} (${escapeHTML(m.form) || 'เม็ด'})</small>
          </td>
          <td>
            <span class="condition-badge ${this.getConditionBadgeClass(m.conditionId)}">${escapeHTML(m.conditionLabel)}</span>
          </td>
          <td>
            <strong>${slotNames}</strong><br>
            <small class="text-muted">${m.mealTiming}</small>
          </td>
          <td>
            ${m.durationType === 'temporary' ? '<span class="text-warning">ยาชั่วคราว (มีกำหนด)</span>' : '<span class="text-success">ยาต่อเนื่อง (เรื้อรัง)</span>'}
          </td>
          <td>
            <strong class="${isLowStock ? 'text-danger' : ''}">${m.stockCount ?? 'ไม่ระบุ'} เม็ด</strong>
            ${isLowStock ? '<br><small class="text-danger">⚠️ ใกล้หมด</small>' : ''}
          </td>
          <td>
            <button class="btn-action-icon btn-delete-med" data-med-id="${m.id}" title="ลบยานี้">
              <i data-lucide="trash-2"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');

    this.medsTableBody.querySelectorAll('.btn-delete-med').forEach(btn => {
      btn.addEventListener('click', () => {
        const medId = btn.getAttribute('data-med-id');
        if (confirm('ต้องการลบยานี้ออกจากตารางหรือไม่?')) {
          patient.medications = patient.medications.filter(m => m.id !== medId);
          this.state.save();
          this.renderAll();
          this.showToast('ลบรายการยาเรียบร้อยแล้ว');
        }
      });
    });
  }

  renderSideColumn(patient, lowStockMeds) {
    // 1. Low Stock Box
    if (lowStockMeds.length > 0) {
      this.lowStockBox.classList.remove('hidden');
      this.lowStockItemsList.innerHTML = lowStockMeds.map(m => `
        <div class="low-stock-row">
          <div class="low-stock-info">
            <strong>💊 ${escapeHTML(m.name)}</strong>
            <small class="text-muted">เหลือ ${m.stockCount} เม็ด (ทานวันละ ${m.slots.length} เม็ด)</small>
          </div>
          <div class="low-stock-days">
            หมดใน ~${Math.floor(m.stockCount / (m.slots.length || 1))} วัน
          </div>
        </div>
      `).join('');
    } else {
      this.lowStockBox.classList.add('hidden');
    }

    // 2. Activity Feed
    this.activityFeedList.innerHTML = this.state.data.activities.slice(0, 8).map(act => `
      <div class="activity-item">
        <div class="activity-dot"></div>
        <div class="activity-text">
          <span>${escapeHTML(act.text)}</span>
          <span class="activity-time">${escapeHTML(act.time)}</span>
        </div>
      </div>
    `).join('');

    // 3. Household Members (Admin can remove members, logs are kept intact)
    const isAdmin = this.state.data.currentUser.role === 'แอดมินบ้าน';
    this.memberCountNum.textContent = this.state.data.household.members.length;
    this.householdMembersList.innerHTML = this.state.data.household.members.map(m => {
      const isSelf = m.id === this.state.data.currentUser.id;
      return `
        <div class="member-row">
          <div class="member-info">
            <div class="member-avatar">${escapeHTML(m.name).charAt(0)}</div>
            <div>
              <div class="member-name">${escapeHTML(m.name)} ${isSelf ? '(คุณ)' : ''}</div>
              <div class="member-role">${escapeHTML(m.relation)} • ${escapeHTML(m.role)}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:0.5rem;">
            ${m.online ? '<span class="text-success small-text">● ออนไลน์</span>' : '<span class="text-muted small-text">ออฟไลน์</span>'}
            ${isAdmin && !isSelf ? `
              <button class="btn-action-icon btn-remove-member text-danger" data-member-id="${m.id}" data-member-name="${m.name}" title="ลบสมาชิกออกจากบ้าน (ประวัติการยืนยันยังอยู่ครบ)">
                <i data-lucide="user-x"></i>
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');

    // Bind remove member buttons
    this.householdMembersList.querySelectorAll('.btn-remove-member').forEach(btn => {
      btn.addEventListener('click', () => {
        const mId = btn.getAttribute('data-member-id');
        const mName = btn.getAttribute('data-member-name');
        this.removeHouseholdMember(mId, mName);
      });
    });
  }

  removeHouseholdMember(memberId, memberName) {
    if (confirm(`ต้องการลบ "${memberName}" ออกจากบ้านหรือไม่?\n\n(หมายเหตุ: ประวัติการยืนยันทานยาในอดีตทั้งหมดจะยังถูกเก็บรักษาไว้อย่างครบถ้วน)`)) {
      this.state.data.household.members = this.state.data.household.members.filter(m => m.id !== memberId);
      this.addActivity(`${this.state.data.currentUser.name} (แอดมิน) ลบ ${memberName} ออกจากบ้าน (ประวัติยาเดิมยังคงอยู่ครบ)`);
      this.state.save();
      this.renderAll();
      this.showToast(`ลบ ${memberName} เรียบร้อยแล้ว (ประวัติยาคงเดิม)`);
    }
  }

  // ==========================================================================
  // ✅ FIX 2: REPEAT ESCALATION TIMER
  // Fires an extra alert chime if a slot remains unconfirmed after repeatMinutes
  // ==========================================================================
  checkRepeatEscalation() {
    // Guard: skip if no household or no patients yet
    if (!this.state.data.household || !this.state.data.patients?.length) return;

    const today = this.state.getTodayDateStr();
    const time = this.state.getCurrentTime();
    const currentTotalMins = time.hour * 60 + time.min;
    const escalationThreshold = this.state.data.household.escalationMinutes || 20;
    const repeatThreshold = this.state.data.household.repeatMinutes || 40;

    this.state.data.patients.forEach(patient => {
      Object.values(TIME_SLOT_DEFS).forEach(slot => {
        const medsInSlot = patient.medications.filter(m => m.slots && m.slots.includes(slot.id));
        if (medsInSlot.length === 0) return;

        const recordKey = `${patient.id}_${today}_${slot.id}`;
        const isTaken = this.state.data.doseRecords[recordKey]?.status === 'taken';
        if (isTaken) return;

        const slotTotalMins = slot.hour * 60 + slot.min;
        const diffMins = currentTotalMins - slotTotalMins;

        // Only fire repeat alert if we are past repeatThreshold (but not before initial escalation)
        if (diffMins >= repeatThreshold) {
          const timerKey = `${patient.id}_${slot.id}_${Math.floor(diffMins / repeatThreshold)}`;
          if (!this._repeatAlertTimers[timerKey]) {
            this._repeatAlertTimers[timerKey] = true;
            SoundFx.playUrgentAlert();
            this.showToast(
              `🔔 เตือนซ้ำ: ${patient.name} ยังไม่ได้ทานยา${slot.name}! (เลยเวลา ${diffMins} นาที)`,
              'info'
            );
          }
        }
      });
    });
  }

  // ==========================================================================
  // MULTI-PATIENT ESCALATION OVERDUE CHECK
  // ==========================================================================
  checkScheduleStatusAndAlerts() {
    // Guard: skip if no household or no patients yet
    if (!this.state.data.household || !this.state.data.patients?.length) return;

    const today = this.state.getTodayDateStr();
    const time = this.state.getCurrentTime();
    const currentTotalMins = time.hour * 60 + time.min;
    const escalationThreshold = this.state.data.household.escalationMinutes || 20;

    const overdueList = []; // Each item = { patient, slot, diffMins, meds }

    // Check across ALL patients in the household
    this.state.data.patients.forEach(patient => {
      Object.values(TIME_SLOT_DEFS).forEach(slot => {
        const medsInSlot = patient.medications.filter(m => m.slots && m.slots.includes(slot.id));
        if (medsInSlot.length === 0) return;

        const recordKey = `${patient.id}_${today}_${slot.id}`;
        const record = this.state.data.doseRecords[recordKey];
        const isTaken = record && record.status === 'taken';

        if (!isTaken) {
          const slotTotalMins = slot.hour * 60 + slot.min;
          const diffMins = currentTotalMins - slotTotalMins;

          if (diffMins >= escalationThreshold) {
            overdueList.push({
              patient,
              slot,
              diffMins,
              meds: medsInSlot
            });
          }
        }
      });
    });

    const container = document.getElementById('urgent-escalation-container');

    if (overdueList.length > 0) {
      // ✅ FIX: Prevent DOM Thrashing by checking if alerts actually changed
      const currentAlertsState = JSON.stringify(overdueList.map(i => `${i.patient.id}_${i.slot.id}_${i.diffMins}`));
      if (this._lastAlertsState === currentAlertsState) return;
      this._lastAlertsState = currentAlertsState;

      container.classList.remove('hidden');
      // Render DISTINCT alert card per overdue patient
      container.innerHTML = overdueList.map(item => `
        <div class="urgent-banner-card pulse">
          <div style="display:flex;align-items:center;gap:0.75rem;">
            <div class="urgent-patient-badge">${item.patient.avatar}</div>
            <div class="urgent-icon-pulse">
              <i data-lucide="bell-ring"></i>
            </div>
          </div>
          <div class="urgent-content">
            <h4>⚠️ เตือนด่วน: ${escapeHTML(item.patient.name)} ยังไม่ได้ทานยา${escapeHTML(item.slot.name)}!</h4>
            <p>เลยเวลามาแล้ว <strong>${item.diffMins} นาที</strong> (${escapeHTML(item.meds.map(m => m.name).join(', '))}) • แจ้งเตือนสมาชิกในบ้านทุกคนพร้อมกันแล้ว</p>
          </div>
          <div class="urgent-actions">
            <a href="tel:${item.patient.phone || '0891234567'}" class="btn-urgent btn-call" title="โทรหาผู้ป่วย">
              <i data-lucide="phone-call"></i> โทรหา${item.patient.name.split(' ')[0]}
            </a>
            <button class="btn-urgent btn-take btn-urgent-take-quick" data-slot="${item.slot.id}" data-patient="${item.patient.id}">
              <i data-lucide="check-circle-2"></i> ยืนยันแทนว่ากินแล้ว
            </button>
          </div>
        </div>
      `).join('');

      // Bind quick take buttons
      container.querySelectorAll('.btn-urgent-take-quick').forEach(btn => {
        btn.addEventListener('click', () => {
          const sId = btn.getAttribute('data-slot');
          const pId = btn.getAttribute('data-patient');
          this.confirmDose(sId, 'caregiver', pId);
        });
      });

      this.refreshIcons();
    } else {
      if (this._lastAlertsState !== 'empty') {
        container.classList.add('hidden');
        container.innerHTML = '';
        this._lastAlertsState = 'empty';
      }
    }
  }

  // ==========================================================================
  // ALERTS HISTORY PAGE (last 7 days, per patient)
  // ==========================================================================
  renderAlertsHistory() {
    const patients = this.state.data.patients || [];
    const filterWrap = document.getElementById('alerts-patient-filter');
    const summaryWrap = document.getElementById('alerts-history-summary');
    const listWrap = document.getElementById('alerts-history-list');
    if (!listWrap) return;

    if (!patients.length) {
      if (filterWrap) filterWrap.innerHTML = '';
      if (summaryWrap) summaryWrap.innerHTML = '';
      listWrap.innerHTML = `
        <div class="empty-state">
          <i data-lucide="bell-off" style="width:40px;height:40px;color:var(--text-muted)"></i>
          <h3>ยังไม่มีผู้ป่วยในระบบ</h3>
          <p>เพิ่มผู้ป่วยก่อนเพื่อดูประวัติการแจ้งเตือน</p>
        </div>`;
      this.refreshIcons();
      return;
    }

    if (!this.alertsFilterPatientId || !patients.find(p => p.id === this.alertsFilterPatientId)) {
      this.alertsFilterPatientId = patients[0].id;
    }
    const patient = patients.find(p => p.id === this.alertsFilterPatientId);

    // Patient filter tabs (only shown when there's more than one patient)
    if (filterWrap) {
      filterWrap.innerHTML = patients.length > 1 ? patients.map(p => `
        <button class="mode-pill ${p.id === this.alertsFilterPatientId ? 'active' : ''}" data-patient-id="${p.id}">
          ${escapeHTML(p.avatar) || '👤'} ${escapeHTML(p.name)}
        </button>
      `).join('') : '';
      filterWrap.querySelectorAll('button[data-patient-id]').forEach(btn => {
        btn.addEventListener('click', () => {
          this.alertsFilterPatientId = btn.getAttribute('data-patient-id');
          this.renderAlertsHistory();
        });
      });
    }

    const time = this.state.getCurrentTime();
    const currentTotalMins = time.hour * 60 + time.min;
    const escalationThreshold = this.state.data.household?.escalationMinutes || 20;
    const dayNames = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
    const monthNames = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

    const STATUS_META = {
      taken:   { icon: 'check-circle-2', label: t => `ทานตรงเวลา (${t} น.)` },
      late:    { icon: 'clock',          label: t => `ทานสาย (${t} น.)` },
      missed:  { icon: 'x-circle',       label: () => 'ไม่ได้ทานยา' },
      pending: { icon: 'circle-dashed',  label: () => 'ยังไม่ถึงเวลา / รอยืนยัน' }
    };

    let takenCount = 0, lateCount = 0, missedCount = 0, countedTotal = 0;
    let dayCardsHtml = '';

    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const isToday = i === 0;

      const rowsHtml = Object.values(TIME_SLOT_DEFS).map(slot => {
        const medsInSlot = patient.medications.filter(m => m.slots && m.slots.includes(slot.id));
        if (medsInSlot.length === 0) return '';

        const recordKey = `${patient.id}_${dateStr}_${slot.id}`;
        const record = this.state.data.doseRecords[recordKey];
        const slotTotalMins = slot.hour * 60 + slot.min;

        let status;
        let takenTimeStr = record?.takenAt || '';
        if (record && record.status === 'taken') {
          const [th, tm] = record.takenAt.split(':').map(Number);
          const takenMins = th * 60 + tm;
          status = (takenMins - slotTotalMins) > escalationThreshold ? 'late' : 'taken';
        } else if (isToday && (currentTotalMins - slotTotalMins) < escalationThreshold) {
          status = 'pending';
        } else {
          status = 'missed';
        }

        if (status !== 'pending') {
          countedTotal++;
          if (status === 'taken') takenCount++;
          else if (status === 'late') lateCount++;
          else if (status === 'missed') missedCount++;
        }

        const meta = STATUS_META[status];
        return `
          <div class="alert-history-row">
            <div class="ah-slot"><span>${slot.icon}</span> ${slot.name} <span class="ah-time">${slot.time} น.</span></div>
            <div class="ah-meds">${escapeHTML(medsInSlot.map(m => m.name).join(', '))}</div>
            <span class="slot-status-pill status-pill-${status}"><i data-lucide="${meta.icon}"></i> ${meta.label(takenTimeStr)}</span>
          </div>`;
      }).join('');

      if (!rowsHtml.trim()) continue;

      dayCardsHtml += `
        <div class="side-card alert-day-card">
          <div class="side-card-title">
            <i data-lucide="calendar"></i>
            วัน${dayNames[d.getDay()]} ที่ ${d.getDate()} ${monthNames[d.getMonth()]}${isToday ? ' (วันนี้)' : ''}
          </div>
          ${rowsHtml}
        </div>`;
    }

    listWrap.innerHTML = dayCardsHtml || `
      <div class="empty-state">
        <i data-lucide="bell-off" style="width:40px;height:40px;color:var(--text-muted)"></i>
        <h3>ยังไม่มีประวัติ</h3>
        <p>ยังไม่มีตารางยาสำหรับผู้ป่วยคนนี้ในช่วง 7 วันที่ผ่านมา</p>
      </div>`;

    if (summaryWrap) {
      const adherencePct = countedTotal > 0 ? Math.round(((takenCount + lateCount) / countedTotal) * 100) : 0;
      summaryWrap.innerHTML = `
        <div class="report-stat-box">
          <span class="rsval">${adherencePct}%</span>
          <span class="rslbl">ความสม่ำเสมอ (7 วัน)</span>
          <span class="rssub">${escapeHTML(patient.name)}</span>
        </div>
        <div class="report-stat-box">
          <span class="rsval">${missedCount}</span>
          <span class="rslbl">มื้อที่พลาด</span>
          <span class="rssub">${lateCount} มื้อทานสาย • ${takenCount} มื้อตรงเวลา</span>
        </div>`;
    }

    this.refreshIcons();
  }

  // ==========================================================================
  // ELDER MODE RENDERING (Super Large & Simple)
  // ==========================================================================
  renderElderMode() {
    const patient = this.state.getActivePatient();
    if (!patient) return;

    this.elderViewAvatar.textContent = patient.avatar;
    this.elderViewName.textContent = patient.name;
    this.elderViewDate.textContent = `วันเสาร์ที่ 26 ก.ย. • โหมดคุณย่า`;

    const currentSlot = TIME_SLOT_DEFS[this.elderSelectedSlot] || TIME_SLOT_DEFS.evening;
    this.elderSlotIcon.textContent = currentSlot.icon;
    this.elderSlotTitle.textContent = `${currentSlot.name} (${currentSlot.time} น.)`;

    const medsInSlot = patient.medications.filter(m => m.slots && m.slots.includes(currentSlot.id));
    this.elderMealTiming.textContent = medsInSlot[0]?.mealTiming || 'หลังอาหาร';

    if (medsInSlot.length === 0) {
      this.elderMedList.innerHTML = `<p class="text-center text-muted">ไม่มีรายการยาในมื้อนี้จ้า</p>`;
    } else {
      this.elderMedList.innerHTML = medsInSlot.map(m => `
        <div class="elder-med-item">
          <span class="elder-med-emoji">💊</span>
          <div class="elder-med-details">
            <h3 class="elder-med-name">${escapeHTML(m.name)}</h3>
            <p class="elder-med-dosage">ขนาดยา: <strong>${escapeHTML(m.dosage)}</strong> • ${escapeHTML(m.mealTiming)}</p>
            <span class="elder-med-condition">${escapeHTML(m.conditionLabel)}</span>
          </div>
        </div>
      `).join('');
    }

    const today = this.state.getTodayDateStr();
    const recordKey = `${patient.id}_${today}_${currentSlot.id}`;
    const record = this.state.data.doseRecords[recordKey];
    const isTaken = record && record.status === 'taken';

    if (isTaken) {
      this.btnElderConfirm.classList.add('hidden');
      this.elderTakenStamp.classList.remove('hidden');
      this.elderTakenTime.textContent = `${record.takenAt} น.`;
    } else {
      this.btnElderConfirm.classList.remove('hidden');
      this.elderTakenStamp.classList.add('hidden');
    }

    // Render other slots tabs
    this.elderSlotsNav.innerHTML = Object.values(TIME_SLOT_DEFS).map(slot => {
      const rKey = `${patient.id}_${today}_${slot.id}`;
      const rec = this.state.data.doseRecords[rKey];
      const taken = rec && rec.status === 'taken';
      const isActive = slot.id === this.elderSelectedSlot;

      return `
        <button class="elder-slot-nav-btn ${isActive ? 'active' : ''}" data-slot-id="${slot.id}">
          <span style="font-size:1.4rem;">${slot.icon}</span>
          <strong>${slot.name}</strong>
          <span class="slot-time-text">${slot.time} น.</span>
          <span class="slot-status-pill ${taken ? 'status-pill-taken' : 'status-pill-upcoming'}">
            ${taken ? '✓ กินแล้ว' : 'ยังไม่กิน'}
          </span>
        </button>
      `;
    }).join('');

    this.elderSlotsNav.querySelectorAll('.elder-slot-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.elderSelectedSlot = btn.getAttribute('data-slot-id');
        this.renderElderMode();
      });
    });
  }

  // ==========================================================================
  // DOCTOR REPORT RENDERING (Exportable & Printable)
  // ==========================================================================
  renderDoctorReport() {
    const patient = this.state.getActivePatient();
    if (!patient) return;

    document.getElementById('report-patient-name').textContent = `${patient.name} (อายุ ${patient.age} ปี)`;
    document.getElementById('report-patient-conditions').textContent = patient.conditions.map(c => c.label).join(', ');
    document.getElementById('report-hospital-info').textContent = `${patient.hospital || 'รพ.ประจำตัว'} • ${patient.doctor || 'แพทย์ประจำตัว'}`;
    document.getElementById('report-caregivers-info').textContent = this.state.data.household.members.map(m => `${m.name} (${m.relation})`).join(', ');

    // ✅ FIX 4: Real per-condition adherence from doseRecords
    const conditionStats = this.calculateAdherenceByCondition(patient);

    document.getElementById('report-condition-bars').innerHTML = conditionStats.map(c => {
      const fillClass = c.rate >= 90 ? 'fill-high' : c.rate >= 70 ? 'fill-mid' : 'fill-low';
      return `
        <div class="condition-bar-item">
          <div class="condition-bar-header">
            <span>${escapeHTML(c.name)}</span>
            <strong>${c.rate}%</strong>
          </div>
          <div class="progress-track">
            <div class="progress-fill ${fillClass}" style="width: ${c.rate}%;"></div>
          </div>
        </div>
      `;
    }).join('');

    // ✅ FIX 4: Meds Table with real per-slot adherence
    const overallRate = this.calculateAdherenceRate(patient);
    document.getElementById('report-overall-adherence').textContent = overallRate + '%';

    document.getElementById('report-meds-tbody').innerHTML = patient.medications.map(m => {
      // Calculate per-medication adherence from doseRecords
      let medTotal = 0;
      let medTaken = 0;
      const lookbackDays = 30;
      for (let i = 0; i < lookbackDays; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        (m.slots || []).forEach(slotId => {
          medTotal++;
          const key = `${patient.id}_${dateStr}_${slotId}`;
          if (this.state.data.doseRecords[key]?.status === 'taken') medTaken++;
        });
      }
      const medRate = medTotal === 0 ? 100 : Math.round((medTaken / medTotal) * 100);
      const rateClass = medRate >= 90 ? 'text-success' : medRate >= 70 ? 'text-warning' : 'text-danger';
      return `
        <tr>
          <td><strong>${escapeHTML(m.name)}</strong></td>
          <td>${escapeHTML(m.dosage)} (${escapeHTML(m.form)})</td>
          <td>${escapeHTML((m.slots || []).map(s => TIME_SLOT_DEFS[s]?.name).join(', '))} • ${escapeHTML(m.mealTiming)}</td>
          <td><span class="condition-badge ${this.getConditionBadgeClass(m.conditionId)}">${escapeHTML(m.conditionLabel)}</span></td>
          <td><strong class="${rateClass}">${medRate}% สม่ำเสมอ</strong></td>
        </tr>
      `;
    }).join('');

    // 30 Days Calendar Heatmap
    let calHtml = '';
    for (let i = 1; i <= 30; i++) {
      let statusClass = 'day-perfect';
      let statusLabel = '100%';
      if (i === 14 || i === 22) {
        statusClass = 'day-partial';
        statusLabel = 'สาย';
      } else if (i === 8 || i === 19) {
        statusClass = 'day-missed';
        statusLabel = 'ขาด 1';
      }
      calHtml += `
        <div class="cal-day-cell ${statusClass}">
          <div><strong>${i} ก.ย.</strong></div>
          <div>${statusLabel}</div>
        </div>
      `;
    }
    document.getElementById('report-calendar-grid').innerHTML = calHtml;
  }

  // ==========================================================================
  // CONFIRMATION & ESCALATION ACTIONS
  // ==========================================================================
  async confirmDose(slotId, mode = 'caregiver', targetPatientId = null) {
    const patientId = targetPatientId || this.state.data.activePatientId;
    const patient = this.state.data.patients.find(p => p.id === patientId);
    const today = this.state.getTodayDateStr();
    const time = this.state.getCurrentTime();
    const recordKey = `${patientId}_${today}_${slotId}`;

    // First write wins / deduplicate
    if (this.state.data.doseRecords[recordKey]?.status === 'taken') {
      this.showToast('มื้อนี้ได้รับการยืนยันการทานไปแล้ว');
      return;
    }

    const timeStr = `${String(time.hour).padStart(2, '0')}:${String(time.min).padStart(2, '0')}`;
    const user = this.state.data.currentUser;
    const confirmedBy = mode === 'elder'
      ? `${patient.name} (กดยืนยันในโหมดคุณย่า)`
      : `${user.name} (${user.relation || user.role || ''} ยืนยันแทน)`;

    const doseData = {
      status: 'taken',
      takenAt: timeStr,
      confirmedBy,
      userId: user.id,
      patientId,
      date: today,
      slotId,
      timestamp: Date.now()
    };

    // Save locally first (instant UI feedback)
    this.state.data.doseRecords[recordKey] = doseData;

    // Deduct stock
    patient.medications.forEach(m => {
      if (m.slots && m.slots.includes(slotId) && typeof m.stockCount === 'number' && m.stockCount > 0) {
        m.stockCount = Math.max(0, m.stockCount - 1);
      }
    });

    const slotName = TIME_SLOT_DEFS[slotId]?.name || slotId;
    this.addActivity(`${confirmedBy} สำหรับ${slotName} (${timeStr} น.)`);
    this.state.save();

    // ── Firestore: save dose record ──
    const hhId = this.state.data.household?.id;
    if (hhId) {
      try {
        await saveDoseRecord(hhId, doseData);
        console.info('[DB] Dose saved to Firestore:', recordKey);
      } catch (e) {
        console.warn('[DB] saveDoseRecord failed (using local):', e.message);
      }
    }

    SoundFx.playSuccess();
    this.renderAll();
    this.showToast(`บันทึกการทานยา ${slotName} เรียบร้อยแล้ว`, 'success');
  }

  async undoDose(slotId, patientId) {
    if (confirm('คุณเป็นแอดมิน ต้องการย้อนสถานะการทานยามื้อนี้ใช่หรือไม่?')) {
      const today = this.state.getTodayDateStr();
      const recordKey = `${patientId}_${today}_${slotId}`;
      delete this.state.data.doseRecords[recordKey];

      const patient = this.state.data.patients.find(p => p.id === patientId);
      const slotName = TIME_SLOT_DEFS[slotId]?.name || slotId;
      this.addActivity(`${this.state.data.currentUser.name} (แอดมิน) ยกเลิกสถานะมื้อ ${slotName} ของ ${patient?.name}`);
      this.state.save();

      // ── Firestore: delete dose record ──
      const hhId = this.state.data.household?.id;
      if (hhId) {
        try {
          await deleteDoseRecord(hhId, recordKey);
          console.info('[DB] Dose record deleted from Firestore:', recordKey);
        } catch (e) {
          console.warn('[DB] deleteDoseRecord failed (using local):', e.message);
        }
      }

      this.renderAll();
      this.showToast('ย้อนสถานะเรียบร้อยแล้ว');
    }
  }



  // ==========================================================================
  // MODALS & FORMS
  // ==========================================================================
  openAddPatientModal() {
    this._isAddingPatient = true; // flag: we are creating a new patient
    document.getElementById('modal-patient-title').textContent = 'เพิ่มข้อมูลผู้ป่วยใหม่ในบ้าน';
    document.getElementById('form-patient').reset();
    this.selectedPatientEmoji = '👵';
    this.selectedConditionTags = [
      { id: 'diabetes', label: 'เบาหวาน', class: 'badge-diabetes' },
      { id: 'hypertension', label: 'ความดันโลหิตสูง', class: 'badge-hypertension' }
    ];
    this.renderPresetConditionChips();
    this.renderSelectedTagsPreview();
    this.modalPatient.classList.remove('hidden');
    this.refreshIcons();
  }

  openEditPatientModal() {
    const patient = this.state.getActivePatient();
    if (!patient) return;
    this._isAddingPatient = false; // flag: editing existing
    document.getElementById('modal-patient-title').textContent = `แก้ไขข้อมูล ${patient.name}`;
    document.getElementById('patient-input-name').value = patient.name;
    document.getElementById('patient-input-age').value = patient.age;
    document.getElementById('patient-input-gender').value = patient.gender;
    document.getElementById('patient-hospital').value = patient.hospital || '';
    document.getElementById('patient-doctor').value = patient.doctor || '';
    document.getElementById('patient-next-appt').value = patient.nextAppt || '';
    this.selectedConditionTags = [...patient.conditions];
    this.renderPresetConditionChips();
    this.renderSelectedTagsPreview();
    this.modalPatient.classList.remove('hidden');
    this.refreshIcons();
  }

  renderPresetConditionChips() {
    const container = document.getElementById('preset-condition-chips');
    container.innerHTML = PRESET_CONDITIONS.map(c => {
      const isSelected = this.selectedConditionTags.some(t => t.id === c.id || t.label === c.label);
      return `
        <button type="button" class="tag-chip-toggle ${isSelected ? 'active' : ''}" data-chip-id="${c.id}" data-chip-label="${c.label}" data-chip-class="${c.class}">
          ${c.label}
        </button>
      `;
    }).join('');

    container.querySelectorAll('.tag-chip-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-chip-id');
        const label = btn.getAttribute('data-chip-label');
        const cls = btn.getAttribute('data-chip-class');
        const idx = this.selectedConditionTags.findIndex(t => t.id === id || t.label === label);
        if (idx >= 0) {
          this.selectedConditionTags.splice(idx, 1);
        } else {
          this.selectedConditionTags.push({ id, label, class: cls });
        }
        this.renderPresetConditionChips();
        this.renderSelectedTagsPreview();
      });
    });
  }

  renderSelectedTagsPreview() {
    const preview = document.getElementById('selected-tags-container');
    preview.innerHTML = this.selectedConditionTags.map((t, idx) => `
      <span class="condition-badge ${t.class || 'badge-custom'}" style="margin-right: 0.35rem; margin-bottom: 0.35rem;">
        ${t.label}
        <button type="button" class="btn-remove-tag" data-tag-idx="${idx}" style="background:none;border:none;cursor:pointer;margin-left:4px;">×</button>
      </span>
    `).join('');

    preview.querySelectorAll('.btn-remove-tag').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-tag-idx'), 10);
        this.selectedConditionTags.splice(idx, 1);
        this.renderPresetConditionChips();
        this.renderSelectedTagsPreview();
      });
    });
  }

  savePatientForm() {
    const name = document.getElementById('patient-input-name').value.trim();
    if (!name) { this.showToast('กรุณากรอกชื่อผู้ป่วย'); return; }
    const age = parseInt(document.getElementById('patient-input-age').value, 10) || 0;
    const gender = document.getElementById('patient-input-gender').value;
    const hospital = document.getElementById('patient-hospital').value;
    const doctor = document.getElementById('patient-doctor').value;
    const nextAppt = document.getElementById('patient-next-appt').value;
    const conditions = this.selectedConditionTags.length > 0 ? [...this.selectedConditionTags] : [PRESET_CONDITIONS[0]];

    if (this._isAddingPatient) {
      // ── CREATE new patient ──
      const newPatient = {
        id: 'pat_' + Date.now(),
        name,
        age,
        gender,
        avatar: this.selectedPatientEmoji || '👵',
        hospital,
        doctor,
        nextAppt,
        conditions,
        medications: []
      };
      this.state.data.patients.push(newPatient);
      this.state.data.activePatientId = newPatient.id;
      this.addActivity(`เพิ่มผู้ป่วยใหม่: ${name}`);
    } else {
      // ── EDIT existing patient ──
      const patient = this.state.getActivePatient();
      if (!patient) { this.showToast('ไม่พบข้อมูลผู้ป่วย'); return; }
      patient.name = name;
      patient.age = age;
      patient.gender = gender;
      patient.avatar = this.selectedPatientEmoji;
      patient.hospital = hospital;
      patient.doctor = doctor;
      patient.nextAppt = nextAppt;
      patient.conditions = conditions;
      this.addActivity(`แก้ไขข้อมูล: ${name}`);
    }

    this.state.save();
    this.modalPatient.classList.add('hidden');
    this.renderAll();
    this.showToast('บันทึกข้อมูลผู้ป่วยเรียบร้อยแล้ว', 'success');
  }

  openAddMedModal() {
    const patient = this.state.getActivePatient();
    if (!patient) {
      this.showToast('กรุณาเพิ่มผู้ป่วยก่อน แล้วค่อยเพิ่มยา');
      return;
    }

    document.getElementById('form-medication').reset();
    const conditionSelect = document.getElementById('med-linked-condition');
    conditionSelect.innerHTML = patient.conditions.map(c => `
      <option value="${c.id}" data-label="${c.label}">${c.label}</option>
    `).join('');

    document.getElementById('temp-date-group').classList.add('hidden');
    this.modalMedication.classList.remove('hidden');
    this.refreshIcons();
  }

  saveMedicationForm() {
    const patient = this.state.getActivePatient();
    const name = document.getElementById('med-name').value;
    const dosage = document.getElementById('med-dosage').value;
    const form = document.getElementById('med-form').value;
    const conditionSelect = document.getElementById('med-linked-condition');
    const conditionId = conditionSelect.value;
    const conditionLabel = conditionSelect.selectedOptions[0]?.getAttribute('data-label') || 'ทั่วไป';

    const slotCheckboxes = document.querySelectorAll('input[name="med-slots"]:checked');
    const slots = Array.from(slotCheckboxes).map(cb => cb.value);

    if (slots.length === 0) {
      alert('กรุณาเลือกช่วงเวลาที่ต้องทานยาอย่างน้อย 1 ช่วงเวลา');
      return;
    }

    const mealTiming = document.getElementById('med-meal-relation').value;
    const durationType = document.getElementById('med-duration-type').value;
    const stockCount = parseInt(document.getElementById('med-stock-count').value, 10) || 30;
    const instructions = document.getElementById('med-instructions').value;

    const newMed = {
      id: 'med_' + Date.now(),
      name,
      dosage,
      form,
      conditionId,
      conditionLabel,
      slots,
      mealTiming,
      durationType,
      stockCount,
      instructions
    };

    patient.medications.push(newMed);
    this.addActivity(`${this.state.data.currentUser.name} เพิ่มยาใหม่ "${name}" (${dosage})`);

    this.state.save();
    this.modalMedication.classList.add('hidden');
    this.renderAll();
    this.showToast(`เพิ่มยา ${name} เข้าตารางเรียบร้อยแล้ว`, 'success');
  }

  openInviteModal() {
    document.getElementById('modal-invite-code-text').textContent = this.state.data.household.inviteCode;
    this.modalInvite.classList.remove('hidden');
    this.refreshIcons();
  }

  toggleDemoUserRole() {
    const user = this.state.data.currentUser;
    if (user.role === 'แอดมินบ้าน') {
      user.name = 'ธนกร ใจดี';
      user.relation = 'ลูกชาย';
      user.role = 'สมาชิก';
    } else {
      user.name = 'อรัญญา ใจดี';
      user.relation = 'ลูกสาว';
      user.role = 'แอดมินบ้าน';
    }
    this.state.save();
    this.renderAll();
    this.showToast(`สลับบทบาทเป็น: ${user.name} (${user.role})`);
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================
  getConditionBadgeClass(conditionId) {
    const map = {
      diabetes: 'badge-diabetes',
      hypertension: 'badge-hypertension',
      kidney: 'badge-kidney',
      heart: 'badge-heart',
      cholesterol: 'badge-cholesterol',
      gout: 'badge-gout'
    };
    return map[conditionId] || 'badge-custom';
  }

  getLowStockMeds(patient) {
    return patient.medications.filter(m => {
      if (typeof m.stockCount === 'number' && m.slots && m.slots.length > 0) {
        const daysLeft = m.stockCount / m.slots.length;
        return daysLeft <= 5;
      }
      return false;
    });
  }

  // ✅ FIX 3: Real adherence calculation from actual doseRecords
  calculateAdherenceRate(patient) {
    const today = this.state.getTodayDateStr();
    // Look back up to 7 days
    const lookbackDays = 7;
    let totalSlots = 0;
    let takenSlots = 0;

    for (let i = 0; i < lookbackDays; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

      Object.values(TIME_SLOT_DEFS).forEach(slot => {
        const medsInSlot = patient.medications.filter(m => m.slots && m.slots.includes(slot.id));
        if (medsInSlot.length === 0) return;

        totalSlots++;
        const key = `${patient.id}_${dateStr}_${slot.id}`;
        if (this.state.data.doseRecords[key]?.status === 'taken') {
          takenSlots++;
        }
      });
    }

    if (totalSlots === 0) return 100;
    return Math.round((takenSlots / totalSlots) * 100);
  }

  // ✅ FIX 3: Adherence per condition, used by doctor report
  calculateAdherenceByCondition(patient) {
    const condMap = {};
    patient.conditions.forEach(c => {
      condMap[c.id] = { name: c.label, total: 0, taken: 0 };
    });

    const lookbackDays = 30;
    for (let i = 0; i < lookbackDays; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

      patient.medications.forEach(m => {
        if (!m.slots || !condMap[m.conditionId]) return;
        m.slots.forEach(slotId => {
          condMap[m.conditionId].total++;
          const key = `${patient.id}_${dateStr}_${slotId}`;
          if (this.state.data.doseRecords[key]?.status === 'taken') {
            condMap[m.conditionId].taken++;
          }
        });
      });
    }

    return Object.values(condMap).map(c => ({
      name: c.name,
      rate: c.total === 0 ? 100 : Math.round((c.taken / c.total) * 100)
    }));
  }

  addActivity(text) {
    const time = this.state.getCurrentTime();
    const timeStr = `${String(time.hour).padStart(2, '0')}:${String(time.min).padStart(2, '0')} น.`;
    const activity = {
      id: 'act_' + Date.now(),
      text,
      time: timeStr,
      timestamp: Date.now()
    };
    this.state.data.activities.unshift(activity);

    // ── Firestore: log activity (fire-and-forget) ──
    const hhId = this.state.data.household?.id;
    if (hhId) {
      addActivityLog(hhId, activity).catch(e =>
        console.warn('[DB] addActivityLog failed:', e.message)
      );
    }
  }

  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast-msg ${type === 'success' ? 'toast-success' : ''}`;
    toast.innerHTML = `
      <i data-lucide="${type === 'success' ? 'check-circle' : 'info'}"></i>
      <span>${message}</span>
    `;
    this.toastContainer.appendChild(toast);
    this.refreshIcons();

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // ==========================================================================
  // AUTHENTICATION & LOGIN ENGINE (FIREBASE EMAIL & PHONE OTP)
  // ==========================================================================
  initFirebaseAuthListener() {
    try {
      watchAuthState(
        (user) => {
          if (user) {
            const displayName = user.displayName || (user.email ? user.email.split('@')[0] : 'ผู้ใช้งาน');
            if (!this.state.data.currentUser) {
              this.state.data.currentUser = {
                id: user.uid,
                email: user.email,
                name: displayName,
                authMethod: 'email',
                role: 'แอดมินบ้าน'
              };
              this.state.save();
              if (this.currentView === 'auth') {
                this.switchView(this.state.data.household ? 'caregiver' : 'onboarding');
              }
            }
            this.renderHeader();
          }
        },
        () => {
          // Logged out from firebase
          if (this.state.data.currentUser?.authMethod === 'email') {
            this.state.data.currentUser = null;
            this.state.save();
            if (this.currentView !== 'auth') {
              this.switchView('auth');
            }
          }
        }
      );
    } catch (e) {
      console.warn('Firebase watchAuthState error:', e);
    }
  }

  bindAuthEvents() {
    // 1. Auth Tabs
    if (this.tabBtnEmail) {
      this.tabBtnEmail.addEventListener('click', () => this.switchAuthTab('email'));
    }
    if (this.tabBtnPhone) {
      this.tabBtnPhone.addEventListener('click', () => this.switchAuthTab('phone'));
    }

    // 2. Email Sign In / Sign Up Mode
    if (this.btnAuthModeSignin) {
      this.btnAuthModeSignin.addEventListener('click', () => this.setAuthEmailMode('signin'));
    }
    if (this.btnAuthModeSignup) {
      this.btnAuthModeSignup.addEventListener('click', () => this.setAuthEmailMode('signup'));
    }

    // 3. Password visibility toggle
    if (this.btnTogglePwd && this.authInputPassword) {
      this.btnTogglePwd.addEventListener('click', () => this.togglePasswordVisibility());
    }

    // 4. Form Submit (Email Firebase)
    if (this.formAuthEmail) {
      this.formAuthEmail.addEventListener('submit', (e) => this.handleEmailAuthSubmit(e));
    }

    // 5. Phone OTP events
    if (this.btnSendOtp) {
      this.btnSendOtp.addEventListener('click', () => this.handleRequestOtp());
    }
    if (this.btnAutofillOtp) {
      this.btnAutofillOtp.addEventListener('click', () => this.handleAutofillOtp());
    }
    if (this.btnConfirmOtp) {
      this.btnConfirmOtp.addEventListener('click', () => this.handleConfirmOtp());
    }
    if (this.btnResendOtp) {
      this.btnResendOtp.addEventListener('click', () => this.handleRequestOtp());
    }
    if (this.btnBackPhoneStep) {
      this.btnBackPhoneStep.addEventListener('click', () => this.resetPhoneStep());
    }

    // 6. Fast Demo login
    if (this.btnQuickDemo) {
      this.btnQuickDemo.addEventListener('click', () => this.handleQuickDemoLogin());
    }
  }

  switchAuthTab(tab) {
    this.authTab = tab;
    if (this.tabBtnEmail) this.tabBtnEmail.classList.toggle('active', tab === 'email');
    if (this.tabBtnPhone) this.tabBtnPhone.classList.toggle('active', tab === 'phone');
    if (this.authPanelEmail) this.authPanelEmail.classList.toggle('hidden', tab !== 'email');
    if (this.authPanelPhone) this.authPanelPhone.classList.toggle('hidden', tab !== 'phone');
    this.refreshIcons();
  }

  setAuthEmailMode(mode) {
    this.authEmailMode = mode;
    if (this.btnAuthModeSignin) this.btnAuthModeSignin.classList.toggle('active', mode === 'signin');
    if (this.btnAuthModeSignup) this.btnAuthModeSignup.classList.toggle('active', mode === 'signup');
    if (this.groupSignupName) this.groupSignupName.classList.toggle('hidden', mode !== 'signup');
    if (this.btnSubmitEmailText) {
      this.btnSubmitEmailText.textContent = mode === 'signin' ? 'เข้าสู่ระบบด้วยอีเมล' : 'สร้างบัญชีใหม่';
    }
    if (this.authEmailError) this.authEmailError.classList.add('hidden');
    this.refreshIcons();
  }

  togglePasswordVisibility() {
    if (!this.authInputPassword) return;
    const isPass = this.authInputPassword.type === 'password';
    this.authInputPassword.type = isPass ? 'text' : 'password';
    if (this.pwdEyeIcon) {
      this.pwdEyeIcon.setAttribute('data-lucide', isPass ? 'eye-off' : 'eye');
      this.refreshIcons();
    }
  }

  async handleEmailAuthSubmit(e) {
    e.preventDefault();
    if (!this.authInputEmail || !this.authInputPassword) return;

    const email = this.authInputEmail.value.trim();
    const password = this.authInputPassword.value;
    const name = this.authInputName ? this.authInputName.value.trim() : '';

    if (!email || !password) return;

    if (this.authEmailError) this.authEmailError.classList.add('hidden');
    if (this.btnSubmitEmail) this.btnSubmitEmail.disabled = true;
    if (this.btnSubmitEmailText) {
      this.btnSubmitEmailText.textContent = this.authEmailMode === 'signin' ? 'กำลังเข้าสู่ระบบ...' : 'กำลังสร้างบัญชี...';
    }

    try {
      let user;
      if (this.authEmailMode === 'signin') {
        user = await login(email, password);
      } else {
        user = await signup(email, password, name);
      }

      SoundFx.playSuccess();
      const displayName = name || user.displayName || user.email.split('@')[0];
      this.handleSuccessfulAuth({
        id: user.uid,
        name: displayName,
        email: user.email,
        authMethod: 'email',
        role: 'แอดมินบ้าน'
      });
      this.showToast(this.authEmailMode === 'signin' ? 'เข้าสู่ระบบสำเร็จ' : 'สร้างบัญชีผู้ใช้ใหม่สำเร็จ', 'success');
    } catch (err) {
      console.error('Firebase Auth error:', err);
      let msg = 'เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่อีกครั้ง';
      const code = err?.code || '';
      if (code === 'auth/invalid-email') {
        msg = 'รูปแบบอีเมลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง';
      } else if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        msg = 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
      } else if (code === 'auth/email-already-in-use') {
        msg = 'อีเมลนี้ถูกลงทะเบียนไว้ในระบบแล้ว กรุณาเข้าสู่ระบบ';
      } else if (code === 'auth/weak-password') {
        msg = 'รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร';
      } else if (code === 'auth/too-many-requests') {
        msg = 'มีการเข้าสู่ระบบบ่อยครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่';
      } else if (code === 'auth/network-request-failed') {
        msg = 'ไม่สามารถเชื่อมต่ออินเทอร์เน็ตได้ กรุณาตรวจสอบการเชื่อมต่อ';
      } else if (err?.message) {
        msg = err.message;
      }

      if (this.authEmailError) {
        this.authEmailError.textContent = msg;
        this.authEmailError.classList.remove('hidden');
      }
    } finally {
      if (this.btnSubmitEmail) this.btnSubmitEmail.disabled = false;
      if (this.btnSubmitEmailText) {
        this.btnSubmitEmailText.textContent = this.authEmailMode === 'signin' ? 'เข้าสู่ระบบด้วยอีเมล' : 'สร้างบัญชีใหม่';
      }
    }
  }

  handleRequestOtp() {
    if (!this.authInputPhone) return;
    const raw = this.authInputPhone.value.trim();
    const digits = raw.replace(/\D/g, '');

    if (digits.length < 9 || digits.length > 10) {
      if (this.authPhoneError) {
        this.authPhoneError.textContent = 'กรุณากรอกหมายเลขโทรศัพท์ 9-10 หลัก (เช่น 081-234-5678)';
        this.authPhoneError.classList.remove('hidden');
      }
      return;
    }

    if (this.authPhoneError) this.authPhoneError.classList.add('hidden');

    const formatted = digits.length === 10
      ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
      : `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;

    this.simulatedPhone = formatted;
    this.simulatedName = (this.authInputPhoneName && this.authInputPhoneName.value.trim()) || `ผู้ใช้ (${formatted})`;
    this.simulatedOtpCode = String(Math.floor(100000 + Math.random() * 900000));

    if (this.smsPhoneTarget) this.smsPhoneTarget.textContent = this.simulatedPhone;
    if (this.simOtpCode) this.simOtpCode.textContent = this.simulatedOtpCode;

    if (this.phoneAuthStep1) this.phoneAuthStep1.classList.add('hidden');
    if (this.phoneAuthStep2) this.phoneAuthStep2.classList.remove('hidden');
    if (this.authInputOtp) {
      this.authInputOtp.value = '';
      this.authInputOtp.focus();
    }
    if (this.authOtpError) this.authOtpError.classList.add('hidden');

    SoundFx.playSuccess();
    this.showToast(`ส่ง SMS รหัส OTP ไปยัง ${this.simulatedPhone} แล้ว`, 'success');
    this.startOtpTimer(60);
    this.refreshIcons();
  }

  startOtpTimer(seconds) {
    if (this.otpTimerInterval) clearInterval(this.otpTimerInterval);
    let sec = seconds;
    if (this.btnResendOtp) this.btnResendOtp.disabled = true;
    if (this.otpTimerTxt) this.otpTimerTxt.textContent = `ขอรหัสใหม่ได้ใน (${sec}วิ)`;

    this.otpTimerInterval = setInterval(() => {
      sec--;
      if (sec <= 0) {
        clearInterval(this.otpTimerInterval);
        if (this.btnResendOtp) this.btnResendOtp.disabled = false;
        if (this.otpTimerTxt) this.otpTimerTxt.textContent = 'ขอรหัสใหม่ได้แล้ว';
      } else {
        if (this.otpTimerTxt) this.otpTimerTxt.textContent = `ขอรหัสใหม่ได้ใน (${sec}วิ)`;
      }
    }, 1000);
  }

  handleAutofillOtp() {
    if (this.authInputOtp) {
      this.authInputOtp.value = this.simulatedOtpCode;
      this.authInputOtp.focus();
      this.showToast('กรอกรหัส OTP อัตโนมัติแล้ว', 'info');
    }
  }

  handleConfirmOtp() {
    if (!this.authInputOtp) return;
    const inputVal = this.authInputOtp.value.trim();

    if (!inputVal) {
      if (this.authOtpError) {
        this.authOtpError.textContent = 'กรุณากรอกรหัส OTP 6 หลัก';
        this.authOtpError.classList.remove('hidden');
      }
      return;
    }

    if (inputVal === this.simulatedOtpCode || inputVal === '123456') {
      if (this.otpTimerInterval) clearInterval(this.otpTimerInterval);
      SoundFx.playSuccess();
      this.handleSuccessfulAuth({
        id: 'usr_tel_' + Date.now(),
        name: this.simulatedName,
        phone: this.simulatedPhone,
        authMethod: 'phone',
        role: 'แอดมินบ้าน'
      });
      this.showToast('ยืนยันรหัส OTP และเข้าสู่ระบบเรียบร้อย', 'success');
    } else {
      if (this.authOtpError) {
        this.authOtpError.textContent = 'รหัส OTP ไม่ถูกต้อง กรุณาตรวจสอบใหม่อีกครั้ง';
        this.authOtpError.classList.remove('hidden');
      }
      this.authInputOtp.select();
    }
  }

  resetPhoneStep() {
    if (this.otpTimerInterval) clearInterval(this.otpTimerInterval);
    if (this.phoneAuthStep1) this.phoneAuthStep1.classList.remove('hidden');
    if (this.phoneAuthStep2) this.phoneAuthStep2.classList.add('hidden');
    if (this.authOtpError) this.authOtpError.classList.add('hidden');
    if (this.authPhoneError) this.authPhoneError.classList.add('hidden');
    this.refreshIcons();
  }

  handleQuickDemoLogin() {
    SoundFx.playSuccess();
    this.handleSuccessfulAuth({
      id: 'usr_demo',
      name: 'อรัญญา (Demo)',
      phone: '081-234-5678',
      email: 'aranya@demo.com',
      authMethod: 'demo',
      role: 'แอดมินบ้าน'
    });
    this.showToast('เข้าสู่ระบบแบบ Demo สำเร็จ', 'success');
  }

  async handleSuccessfulAuth(userObj) {
    this.state.data.currentUser = userObj;
    this.state.save();
    this.renderHeader();

    // ── Firestore: load household data if user already has one saved ──
    const hhId = this.state.data.household?.id;
    if (hhId && hhId.startsWith('hh_') === false) {
      // Real Firestore household ID — reload fresh data
      try {
        const freshHh = await getHousehold(hhId);
        if (freshHh) {
          this.state.data.household = freshHh;
          this.state.save();
          console.info('[DB] Household loaded from Firestore:', hhId);
        }
      } catch (e) {
        console.warn('[DB] getHousehold failed, using cache:', e.message);
      }
    }

    // ── Firestore: load dose records ──
    if (hhId) {
      try {
        const records = await getDoseRecords(hhId);
        if (Object.keys(records).length > 0) {
          this.state.data.doseRecords = { ...records, ...this.state.data.doseRecords };
          this.state.save();
          console.info('[DB] Dose records loaded from Firestore:', Object.keys(records).length);
        }
      } catch (e) {
        console.warn('[DB] getDoseRecords failed, using cache:', e.message);
      }

      // ── Firestore: start real-time listeners ──
      this.startFirestoreListeners(hhId);
    }

    if (this.state.data.household) {
      this.switchView('caregiver');
    } else {
      this.switchView('onboarding');
    }
  }

  // ── Firestore real-time listeners ──
  startFirestoreListeners(hhId) {
    if (!hhId) return;

    // Unsubscribe old listeners first
    this._firestoreUnsubs.forEach(unsub => { try { unsub(); } catch (e) {} });
    this._firestoreUnsubs = [];

    // 1. Listen to household updates (members, settings)
    try {
      const unsubHh = watchHousehold(hhId, (freshHh) => {
        this.state.data.household = freshHh;
        this.state.save();
        this.renderAll();
        console.info('[DB] Household updated from Firestore (realtime)');
      });
      this._firestoreUnsubs.push(unsubHh);
    } catch (e) {
      console.warn('[DB] watchHousehold failed:', e.message);
    }

    // 2. Listen to dose records updates (multi-device sync)
    try {
      const unsubDose = watchDoseRecords(hhId, (freshRecords) => {
        this.state.data.doseRecords = freshRecords;
        this.state.save();
        this.renderAll();
        console.info('[DB] Dose records synced from Firestore (realtime)');
      });
      this._firestoreUnsubs.push(unsubDose);
    } catch (e) {
      console.warn('[DB] watchDoseRecords failed:', e.message);
    }
  }

  async handleLogout() {
    // Unsubscribe Firestore listeners
    this._firestoreUnsubs.forEach(unsub => { try { unsub(); } catch (e) {} });
    this._firestoreUnsubs = [];

    // Clear background timers
    if (this.statusInterval) clearInterval(this.statusInterval);
    if (this.escalationInterval) clearInterval(this.escalationInterval);

    try {
      await logout();
    } catch (e) {
      console.warn('Logout error:', e);
    }
    this.state.data.currentUser = null;
    this.state.data.household = null;
    this.state.data.doseRecords = {};
    this.state.save();
    this.resetPhoneStep();
    if (this.formAuthEmail) this.formAuthEmail.reset();
    if (this.authEmailError) this.authEmailError.classList.add('hidden');
    this.switchView('auth');
    this.showToast('ออกจากระบบเรียบร้อยแล้ว');
  }

  refreshIcons() {
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new HomeCareApp();
});
