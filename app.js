/* ==========================================================================
   CARBFLOW 主应用前端交互控制器
   连接 Python SQLite 持久化 API，并在本地维护 LocalStorage 镜像备份。
   ========================================================================== */
window.App = (function () {
  const APP_VERSION = '1.5.5';

  const ACTIVITY_MULTIPLIERS = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    active: 1.725,
    very_active: 1.9,
  };

  const MEAL_LABELS = {
    breakfast: '🌅 早餐',
    lunch: '☀️ 午餐',
    dinner: '🌙 晚餐',
    snack: '🍎 加餐/练后',
  };

  const WORKOUT_LABELS = {
    strength_cardio: '力量+有氧',
    strength: '力量训练',
    cardio: '有氧燃脂',
    hiit: 'HIIT训练',
    rest: '休息日',
  };

  const state = {
    todayStr: formatLocalDate(new Date()),
    activeTab: 'home',
    profile: null,
    plan: null,
    checkins: [],
    todayFoods: [],
    dietFoods: [],
    analytics: null,
    foodCategory: 'all',
    aiPendingItems: [],
    bodyStateSelected: '精力充沛',
    chartRangeDays: 14,
    photoFeatures: { front: null, side: null, back: null },
    photosBase64: { front: null, side: null, back: null },
    aiSettings: null,
    lastMealPhotoBase64: null,
    lastMealColorStats: null,
    currentSearchFoods: [],
    lastRecItems: [],
    addingFoodItem: null,
    offlineMode: !['http:', 'https:'].includes(window.location.protocol),
    backendConfirmed: false,
    onboardStep: 0,
    onboardGender: 'male',
    onboardActivity: 'light',
    onboardRhythmIdx: 0,
  };

  const ONBOARD_RHYTHMS = [
    ['low', 'high', 'low', 'high', 'low', 'high', 'low'],
    ['high', 'low', 'high', 'low', 'high', 'high', 'low'],
    ['low', 'med', 'high', 'low', 'med', 'high', 'med'],
    ['low', 'low', 'high', 'low', 'low', 'high', 'low'],
  ];

  function formatLocalDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function getWeekdayIndex(dateStr) {
    const parts = (dateStr || state.todayStr).split('-').map(Number);
    const dt = new Date(parts[0], parts[1] - 1, parts[2]);
    const jsDay = dt.getDay(); // 0=Sun..6=Sat
    return jsDay === 0 ? 6 : jsDay - 1; // 0=Mon..6=Sun
  }

  function escHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showToast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  async function api(path, options = {}) {
    if (state.offlineMode && window.OfflineEngine) {
      return window.OfflineEngine.handleRequest(path, options);
    }
    const opts = {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    };
    if (opts.body && typeof opts.body !== 'string') {
      opts.body = JSON.stringify(opts.body);
    }
    try {
      const resp = await fetch(path, opts);
      const contentType = resp.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');
      // 仅当响应非 JSON，或后端尚未确认存在时收到 404/405，才自动接管到独立离线引擎（防止合法业务 404 导致后端用户误切离线）
      if ((!isJson || (!state.backendConfirmed && (resp.status === 404 || resp.status === 405))) && window.OfflineEngine) {
        state.offlineMode = true;
        return window.OfflineEngine.handleRequest(path, options);
      }
      state.backendConfirmed = true;
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || `请求失败 (${resp.status})`);
      }
      return data;
    } catch (err) {
      if (state.backendConfirmed) {
        if (
          err instanceof TypeError ||
          String(err.message).includes('Failed to fetch') ||
          String(err.message).includes('NetworkError') ||
          String(err.message).includes('Load failed')
        ) {
          throw new Error('本地服务连接中断，请确认 app.py 仍在运行');
        }
        throw err;
      }
      if (
        window.OfflineEngine &&
        (err instanceof TypeError ||
          err instanceof SyntaxError ||
          String(err.message).includes('Failed to fetch') ||
          String(err.message).includes('NetworkError') ||
          String(err.message).includes('Load failed'))
      ) {
        state.offlineMode = true;
        return window.OfflineEngine.handleRequest(path, options);
      }
      throw err;
    }
  }

  async function init() {
    // 申请持久化存储权限，降低 Android WebView 在存储空间紧张时清理 IndexedDB 的风险
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }

    // 清理热更新刷新后残留的 _r 查询参数
    try {
      const cleanUrl = new URL(window.location.href);
      if (cleanUrl.searchParams.has('_r')) {
        cleanUrl.searchParams.delete('_r');
        window.history.replaceState({}, '', cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
      }
    } catch (_) {}

    // 仅在标准 Web 浏览器/静态托管 App 壳注册 Service Worker，支持应用内热更新与离线缓存
    const isNativeLocalShell = Boolean(window.plus || window.cordova);
    if (!isNativeLocalShell && 'serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('./sw.js?v=9').then((reg) => {
        reg.update().catch(() => {});
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdateBanner({ version: '最新版', notes: '后台已拉取到最新界面与功能，点击即可应用内更新。' });
            }
          });
        });
      }).catch(() => {});
    }

    const verBadge = document.getElementById('appVersionBadge');
    if (verBadge) verBadge.textContent = `v${APP_VERSION}`;

    // 兼容 Android 打包壳（HBuilderX 5+ App / Cordova）物理返回键：先处理引导页 -> 关弹窗 -> 回首页 -> 双击退出 App
    let lastBackPress = 0;
    const handleHardwareBack = (ev) => {
      const entryOverlay = document.getElementById('appEntryOverlay');
      if (entryOverlay && !entryOverlay.classList.contains('hidden')) {
        if (state.onboardStep > 0) {
          if (ev && ev.preventDefault) ev.preventDefault();
          goOnboardStep(state.onboardStep - 1);
          return;
        }
      }
      const aiModal = document.getElementById('aiConfigModal');
      const foodModal = document.getElementById('foodAddModal');
      if (aiModal && aiModal.classList.contains('open')) {
        if (ev && ev.preventDefault) ev.preventDefault();
        closeAiModal();
        return;
      }
      if (foodModal && foodModal.classList.contains('open')) {
        if (ev && ev.preventDefault) ev.preventDefault();
        closeAddFoodModal();
        return;
      }
      if (state.activeTab !== 'home') {
        if (ev && ev.preventDefault) ev.preventDefault();
        switchTab('home');
        return;
      }
      const now = Date.now();
      if (now - lastBackPress < 2000) {
        if (window.plus && window.plus.runtime) window.plus.runtime.quit();
        else if (navigator.app && navigator.app.exitApp) navigator.app.exitApp();
      } else {
        lastBackPress = now;
        showToast('再按一次返回键退出循碳记');
      }
    };
    document.addEventListener('backbutton', handleHardwareBack, false);
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        closeAiModal();
        closeAddFoodModal();
      }
    });
    document.addEventListener('plusready', () => {
      if (window.plus && window.plus.key) {
        window.plus.key.addEventListener('backbutton', handleHardwareBack, false);
      }
    });

    // 支持在「AI饮食」或「身体档案」页直接 Ctrl+V 粘贴截图上传！
    document.addEventListener('paste', (ev) => {
      const items = ev.clipboardData && ev.clipboardData.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (!file) continue;
          if (state.activeTab === 'diet') {
            handleMealPhotoFile(file);
            return;
          }
          if (state.activeTab === 'profile') {
            const emptyView = ['front', 'side', 'back'].find((v) => !state.photosBase64[v] && !(state.profile && state.profile[`${v}_photo`])) || 'front';
            handleBodyPhotoFile(emptyView, file);
            return;
          }
        }
      }
    });

    document.getElementById('dietDateInput').value = state.todayStr;
    document.getElementById('checkinDate').value = state.todayStr;

    document.getElementById('btnToggleWide').addEventListener('click', () => {
      const shell = document.getElementById('appShell');
      shell.classList.toggle('wide-mode');
      document.getElementById('btnToggleWide').textContent = shell.classList.contains('wide-mode')
        ? '手机视图'
        : '宽屏视图';
      if (state.activeTab === 'trends') setTimeout(renderAllCharts, 60);
    });

    document.getElementById('btnQuickCheckin').addEventListener('click', () => {
      switchTab('trends');
    });

    window.addEventListener('resize', () => {
      if (state.activeTab === 'trends') renderAllCharts();
    });

    // App 后台挂起跨过午夜后切回前台时，自动切换至新一天并刷新对应数据
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState !== 'visible' || !state.profile) return;
      const nowStr = formatLocalDate(new Date());
      if (nowStr === state.todayStr) return;
      const oldStr = state.todayStr;
      state.todayStr = nowStr;
      const dietInp = document.getElementById('dietDateInput');
      const chkInp = document.getElementById('checkinDate');
      if (dietInp && dietInp.value === oldStr) dietInp.value = nowStr;
      if (chkInp && chkInp.value === oldStr) chkInp.value = nowStr;
      try {
        await loadDietForDate(nowStr);
      } catch (_) {}
      loadCheckinForDate(chkInp ? chkInp.value : nowStr);
      renderAll();
    });

    try {
      const boot = await api(`/api/bootstrap?date=${state.todayStr}`);
      state.profile = boot.profile;
      state.plan = boot.plan;
      state.checkins = boot.checkins || [];
      state.todayFoods = boot.today_foods || [];
      state.dietFoods = boot.today_foods || [];
      state.analytics = boot.analytics;
      state.aiSettings = boot.ai_settings || null;
      try {
        const slimBoot = {
          ...boot,
          profile: boot.profile
            ? { ...boot.profile, front_photo: null, side_photo: null, back_photo: null }
            : null,
        };
        localStorage.setItem('carbflow_backup', JSON.stringify(slimBoot));
      } catch (_) {}

      updateHeaderAiBadge();
      hydrateProfileForm();
      hydratePlanControls();
      loadCheckinForDate(state.todayStr);
      renderAll();
      await searchFoodLibrary();

      // 后台静默检查是否有新版本（方案一：静态托管应用内热更新）
      if (window.location.protocol.startsWith('http')) {
        setTimeout(() => checkAppUpdate(false), 1800);
      }

      // 判断是否首次进入（尚未完成引导向导）：首次进入展示全屏沉浸式 4 步引导界面；老用户展示 0.65 秒原生品牌启动欢迎屏后丝滑进入
      const guideDone = Boolean(state.profile.onboarding_completed) && localStorage.getItem('carbflow_guide_v5_done') === '1';
      if (!guideDone) {
        openOnboardingWizard();
      } else {
        const todayIdx = getWeekdayIndex(state.todayStr);
        const tp = state.plan && state.plan.weekly_plan ? state.plan.weekly_plan[todayIdx] : null;
        const greetEl = document.getElementById('obBootGreeting');
        if (greetEl && tp) {
          greetEl.textContent = `欢迎回来，${state.profile.nickname || '减脂进阶者'} · 今日${tp.label} (${Math.round(tp.calories)} kcal)`;
        }
        setTimeout(() => dismissEntryOverlay(), 650);
      }
    } catch (err) {
      dismissEntryOverlay();
      showToast('连接本地服务异常: ' + err.message);
    }
  }

  // ==================== 进入 APP 前的全屏沉浸式引导向导逻辑 ====================
  function dismissEntryOverlay() {
    const ov = document.getElementById('appEntryOverlay');
    if (!ov || ov.classList.contains('hidden')) return;
    ov.classList.add('closing');
    setTimeout(() => {
      ov.classList.add('hidden');
      ov.classList.remove('closing');
    }, 360);
  }

  function openOnboardingWizard() {
    const ov = document.getElementById('appEntryOverlay');
    const bootSplash = document.getElementById('obBootSplash');
    const wiz = document.getElementById('obWizardWrap');
    if (!ov || !wiz) return;

    // 使用当前档案数据预填引导表单
    const p = state.profile || {};
    document.getElementById('obNickname').value = p.nickname || '减脂进阶者';
    document.getElementById('obAge').value = p.age || 22;
    document.getElementById('obHeight').value = p.height_cm || 178;
    document.getElementById('obWeight').value = p.weight_kg || 75;
    document.getElementById('obWaist').value = p.waist_cm ?? 82;
    document.getElementById('obCurrentBf').value = p.current_bf || 18.0;
    document.getElementById('obTargetBf').value = p.target_bf || 13.0;
    document.getElementById('obDeficit').value = p.calorie_deficit || 500;

    selectOnboardGender(p.gender || 'male');
    selectOnboardActivity(p.activity_level && ACTIVITY_MULTIPLIERS[p.activity_level] ? p.activity_level : 'light');
    selectOnboardRhythm(0);

    if (bootSplash) bootSplash.style.display = 'none';
    wiz.style.display = 'flex';
    ov.classList.remove('hidden', 'closing');
    goOnboardStep(0);
    updateOnboardLiveCalc();
  }

  function goOnboardStep(stepIdx) {
    state.onboardStep = Math.max(0, Math.min(3, stepIdx));
    for (let i = 0; i <= 3; i++) {
      const el = document.getElementById(`obStep${i}`);
      if (el) el.classList.toggle('active', i === state.onboardStep);
    }
    const dots = document.querySelectorAll('#obStepDots .onboard-dot');
    dots.forEach((d, idx) => d.classList.toggle('active', idx === state.onboardStep));
    const ov = document.getElementById('appEntryOverlay');
    if (ov) ov.scrollTo({ top: 0, behavior: 'smooth' });
    updateOnboardLiveCalc();
  }

  function selectOnboardGender(gender) {
    state.onboardGender = gender === 'female' ? 'female' : 'male';
    const mBtn = document.getElementById('obGenderMale');
    const fBtn = document.getElementById('obGenderFemale');
    if (mBtn) mBtn.classList.toggle('active', state.onboardGender === 'male');
    if (fBtn) fBtn.classList.toggle('active', state.onboardGender === 'female');
    updateOnboardLiveCalc();
  }

  function selectOnboardActivity(actKey) {
    state.onboardActivity = ACTIVITY_MULTIPLIERS[actKey] ? actKey : 'light';
    ['sedentary', 'light', 'moderate', 'active'].forEach((k) => {
      const btn = document.getElementById(`obAct_${k}`);
      if (btn) btn.classList.toggle('active', k === state.onboardActivity);
    });
    updateOnboardLiveCalc();
  }

  function selectOnboardRhythm(idx) {
    state.onboardRhythmIdx = idx;
    [0, 1, 2, 3].forEach((i) => {
      const btn = document.getElementById(`obRhythm_${i}`);
      if (btn) btn.classList.toggle('active', i === idx);
    });
    updateOnboardLiveCalc();
  }

  function autoEstimateOnboardBf() {
    const h = Math.max(130, Number(document.getElementById('obHeight').value || 178));
    const w = Math.max(35, Number(document.getElementById('obWeight').value || 75));
    const age = Math.max(14, Number(document.getElementById('obAge').value || 22));
    const waist = Number(document.getElementById('obWaist').value || 0);
    const bmi = w / Math.pow(h / 100, 2);
    const isMale = state.onboardGender === 'male';
    let bf = 1.2 * bmi + 0.23 * age - 10.8 * (isMale ? 1 : 0) - 5.4;
    if (waist >= 50) {
      const bfW = isMale ? 64 - (20 * h) / waist : 76 - (20 * h) / (waist * 1.12);
      bf = bf * 0.45 + bfW * 0.55;
    }
    bf = Math.max(isMale ? 7 : 14, Math.min(45, bf));
    const est = Number(bf.toFixed(1));
    document.getElementById('obCurrentBf').value = est;
    document.getElementById('obTargetBf').value = Number(Math.max(isMale ? 11 : 18, est - 5).toFixed(1));
    updateOnboardLiveCalc();
    showToast(`已根据身体围度初估当前体脂约 ${est}%`);
  }

  function updateOnboardLiveCalc() {
    const h = Math.max(130, Number(document.getElementById('obHeight').value || 178));
    const w = Math.max(35, Number(document.getElementById('obWeight').value || 75));
    const age = Math.max(14, Number(document.getElementById('obAge').value || 22));
    const deficit = Number(document.getElementById('obDeficit').value || 500);
    const defLbl = document.getElementById('obDeficitLbl');
    if (defLbl) defLbl.textContent = `${deficit} kcal`;

    const isMale = state.onboardGender === 'male';
    const bmi = w / Math.pow(h / 100, 2);
    const bmiTag = bmi < 18.5 ? '偏瘦' : bmi < 24 ? '标准体型' : bmi < 28 ? '轻度超重' : '减脂重点期';
    const bmr = 10 * w + 6.25 * h - 5 * age + (isMale ? 5 : -161);
    const mult = ACTIVITY_MULTIPLIERS[state.onboardActivity] || 1.375;
    const tdee = bmr * mult;
    const minSafe = isMale ? 1200 : 1050;
    const targetKcal = Math.max(minSafe, tdee - deficit);
    const weeklyLoss = ((tdee - targetKcal) * 7) / 7700;

    const p1 = document.getElementById('obLivePreview1');
    if (p1) {
      p1.innerHTML = `📊 <strong>实时代谢测算</strong>：BMI <strong>${bmi.toFixed(1)}</strong>（${bmiTag}） · 基础代谢 BMR <strong>${Math.round(bmr)} kcal/天</strong>`;
    }

    const p2 = document.getElementById('obLivePreview2');
    if (p2) {
      p2.innerHTML = `🔥 总消耗 TDEE <strong>${Math.round(tdee)} kcal</strong> → 减脂日均目标 <strong>${Math.round(targetKcal)} kcal/天</strong> · 预计每周净减脂 <strong>${weeklyLoss.toFixed(2)} kg</strong>`;
    }

    const sumBox = document.getElementById('obPlanSummaryBox');
    if (sumBox) {
      const highC = ((targetKcal * 0.8) / 4).toFixed(0);
      const highP = ((targetKcal * 0.2) / 4).toFixed(0);
      const lowC = ((targetKcal * 0.3) / 4).toFixed(0);
      const lowP = ((targetKcal * 0.4) / 4).toFixed(0);
      const lowF = ((targetKcal * 0.3) / 9).toFixed(0);
      const sched = ONBOARD_RHYTHMS[state.onboardRhythmIdx] || ONBOARD_RHYTHMS[0];
      const hCnt = sched.filter((x) => x === 'high').length;
      const mCnt = sched.filter((x) => x === 'med').length;
      const lCnt = sched.filter((x) => x === 'low').length;
      sumBox.innerHTML = `
        <div>🎯 <strong>专属碳循环方案预览（每周 ${hCnt}高 · ${mCnt}中 · ${lCnt}低 · 日均 ${Math.round(targetKcal)} kcal）</strong></div>
        <div style="margin-top:4px;">• <strong>高碳日</strong>：碳水 <strong>${highC}g</strong> · 蛋白质 <strong>${highP}g</strong> · 脂肪 <strong>≤10g</strong></div>
        <div>• <strong>低碳日</strong>：碳水 <strong>${lowC}g</strong> · 蛋白质 <strong>${lowP}g</strong> · 脂肪 <strong>${lowF}g</strong></div>
      `;
    }
  }

  async function skipOnboarding() {
    localStorage.setItem('carbflow_guide_v5_done', '1');
    try {
      const res = await api('/api/profile', { method: 'POST', body: { onboarding_completed: 1 } });
      if (res && res.profile) state.profile = res.profile;
    } catch (_) {}
    document.getElementById('onboardingBanner').style.display = 'none';
    dismissEntryOverlay();
  }

  async function finishOnboarding() {
    const workoutMap = { sedentary: 1, light: 3, moderate: 4, active: 6 };
    const sched = ONBOARD_RHYTHMS[state.onboardRhythmIdx] || ONBOARD_RHYTHMS[0];
    const payload = {
      nickname: document.getElementById('obNickname').value.trim() || '减脂进阶者',
      gender: state.onboardGender,
      age: Number(document.getElementById('obAge').value || 22),
      height_cm: Number(document.getElementById('obHeight').value || 178),
      weight_kg: Number(document.getElementById('obWeight').value || 75),
      waist_cm: document.getElementById('obWaist').value ? Number(document.getElementById('obWaist').value) : null,
      activity_level: state.onboardActivity,
      activity_multiplier: ACTIVITY_MULTIPLIERS[state.onboardActivity] || 1.375,
      weekly_workouts: workoutMap[state.onboardActivity] || 3,
      current_bf: Number(document.getElementById('obCurrentBf').value || 18),
      target_bf: Number(document.getElementById('obTargetBf').value || 13),
      calorie_deficit: Number(document.getElementById('obDeficit').value || 500),
      schedule_mode: 'calendar',
      week_schedule_json: sched,
      onboarding_completed: 1,
    };
    try {
      const res = await api('/api/profile', { method: 'POST', body: payload });
      state.profile = res.profile;
      state.plan = res.plan;
      state.analytics = res.analytics;
      localStorage.setItem('carbflow_guide_v5_done', '1');
      document.getElementById('onboardingBanner').style.display = 'none';
      hydrateProfileForm();
      hydratePlanControls();
      loadCheckinForDate(state.todayStr);
      renderAll();
      dismissEntryOverlay();
      switchTab('home');
      showToast('🎉 专属碳循环方案已生成，开启高效减脂！');
    } catch (err) {
      showToast(err.message || '保存引导配置失败');
    }
  }

  function switchTab(tabName) {
    state.activeTab = tabName;
    document.querySelectorAll('.tab-page').forEach((sec) => {
      sec.classList.toggle('active', sec.id === `tab-${tabName}`);
    });
    document.querySelectorAll('.nav-item').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (tabName === 'trends') {
      setTimeout(renderAllCharts, 40);
    }
  }

  function renderAll() {
    if (!state.profile || !state.plan) return;
    renderHome();
    renderPlanTab();
    renderDietLogged();
    renderCheckinHistory();
    if (state.activeTab === 'trends') {
      renderAllCharts();
    }
  }

  // ==================== TAB 1: 首页渲染 ====================
  function renderHome() {
    const p = state.profile;
    const plan = state.plan;
    const todayIdx = getWeekdayIndex(state.todayStr);
    const todayPlan = plan.weekly_plan[todayIdx];

    const weekNames = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];
    document.getElementById('homeDateText').textContent = `${state.todayStr} · ${weekNames[todayIdx]}`;
    document.getElementById('homeGreeting').textContent = `${p.nickname || '减脂进阶者'} · 今日碳循环目标`;
    document.getElementById('topStatusSub').textContent = `今日${todayPlan.label} · 目标 ${todayPlan.calories.toFixed(0)} kcal`;

    const badge = document.getElementById('homeDayBadge');
    badge.className = `day-badge ${todayPlan.day_type}`;
    badge.textContent = todayPlan.label;

    // 统计今日已吃营养素
    let eatenKcal = 0, eatenP = 0, eatenC = 0, eatenF = 0;
    state.todayFoods.forEach((f) => {
      eatenKcal += Number(f.calories || 0);
      eatenP += Number(f.protein_g || 0);
      eatenC += Number(f.carbs_g || 0);
      eatenF += Number(f.fat_g || 0);
    });

    const remainKcal = todayPlan.calories - eatenKcal;
    const ringEl = document.getElementById('homeKcalRing');
    const circumference = 2 * Math.PI * 52;
    const pct = Math.min(1, Math.max(0, eatenKcal / Math.max(1, todayPlan.calories)));
    ringEl.style.strokeDashoffset = String(circumference * (1 - pct));
    ringEl.setAttribute('stroke', remainKcal >= -50 ? '#24C789' : '#EF4444');

    document.getElementById('homeRemainKcal').textContent = Math.round(Math.abs(remainKcal));
    document.getElementById('homeRemainLabel').textContent = remainKcal >= 0 ? '还可摄入 kcal' : '已超目标 kcal';
    document.getElementById('homeEatenKcal').textContent = Math.round(eatenKcal);
    document.getElementById('homeTargetKcal').textContent = todayPlan.calories.toFixed(0);
    document.getElementById('homeRuleNote').textContent = todayPlan.rule_note;

    // 三大营养素进度条
    document.getElementById('homeCarbText').textContent = `${eatenC.toFixed(1)} / ${todayPlan.carbs_g.toFixed(1)}g`;
    document.getElementById('homeCarbBar').style.width = `${Math.min(100, (eatenC / Math.max(1, todayPlan.carbs_g)) * 100)}%`;

    document.getElementById('homeProteinText').textContent = `${eatenP.toFixed(1)} / ${todayPlan.protein_g.toFixed(1)}g`;
    document.getElementById('homeProteinBar').style.width = `${Math.min(100, (eatenP / Math.max(1, todayPlan.protein_g)) * 100)}%`;

    const fatTitle = document.getElementById('homeFatTitle');
    const fatBar = document.getElementById('homeFatBar');
    fatTitle.textContent = todayPlan.fat_is_cap ? '🥑 脂肪 (严控上限)' : '🥑 脂肪';
    document.getElementById('homeFatText').textContent = todayPlan.fat_is_cap
      ? `${eatenF.toFixed(1)} / ≤${todayPlan.fat_g}g`
      : `${eatenF.toFixed(1)} / ${todayPlan.fat_g.toFixed(1)}g`;
    const fatRatio = (eatenF / Math.max(1, todayPlan.fat_g)) * 100;
    fatBar.style.width = `${Math.min(100, fatRatio)}%`;
    fatBar.classList.toggle('fill-danger', todayPlan.fat_is_cap && eatenF > todayPlan.fat_g);

    // 7日周历条
    const strip = document.getElementById('homeWeekStrip');
    const shortDays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const shortType = { high: '高碳', med: '中碳', low: '低碳' };
    strip.innerHTML = plan.weekly_plan
      .map(
        (d, idx) => `
        <div class="week-pill type-${d.day_type} ${idx === todayIdx ? 'today' : ''}" onclick="App.switchTab('plan')">
          <div class="w-day">${shortDays[idx]}</div>
          <div class="w-tag">${shortType[d.day_type]}</div>
          <div class="w-kcal">${Math.round(d.calories)}</div>
        </div>`
      )
      .join('');

    const dc = plan.day_counts;
    document.getElementById('homeScheduleSummary').textContent = `高碳 ${dc.high} 天 · 中碳 ${dc.med} 天 · 低碳 ${dc.low} 天`;
    document.getElementById('homeWeeklyAvgKcal').textContent = `周均 ${plan.weekly_averages.calories.toFixed(1)} kcal/天`;

    // 6宫格核心代谢指标
    const m = plan.metrics;
    document.getElementById('homeBmiTag').textContent = `BMI ${m.bmi} (${m.bmi_category})`;
    document.getElementById('mBmr').textContent = m.bmr.toFixed(1);
    document.getElementById('mTdee').textContent = m.tdee.toFixed(1);
    document.getElementById('mTargetKcal').textContent = m.target_kcal.toFixed(1);
    document.getElementById('mBfPair').textContent = `${m.current_bf}→${m.target_bf}`;
    document.getElementById('mIdealWeight').textContent = m.ideal_target_weight_kg.toFixed(1);
    document.getElementById('mWeeklyLoss').textContent = m.expected_weekly_loss_kg.toFixed(2);

    // 请求今日剩余营养缺口配餐推荐
    const remC = Math.max(0, todayPlan.carbs_g - eatenC);
    const remP = Math.max(0, todayPlan.protein_g - eatenP);
    const remF = Math.max(0, todayPlan.fat_g - eatenF);
    loadMealRecommendation(todayPlan.day_type, remC, remP, remF);
  }

  async function loadMealRecommendation(dayType, remC, remP, remF) {
    try {
      const res = await api(
        `/api/foods/recommend?day_type=${dayType}&rem_carbs=${remC.toFixed(1)}&rem_protein=${remP.toFixed(1)}&rem_fat=${remF.toFixed(1)}`
      );
      const box = document.getElementById('homeAiMealRec');
      const rec = (res.recommendations || [])[0];
      if (!rec) return;
      state.lastRecItems = rec.items || [];
      const itemsHtml = state.lastRecItems
        .map((it) => `${escHtml(it.food_name)} <strong>${it.grams}g</strong>`)
        .join(' + ');
      const totalKcal = state.lastRecItems.reduce((s, i) => s + i.calories, 0).toFixed(0);
      box.innerHTML = `
        <div style="background:#F7FAF9; border:1px solid #D1FAE5; border-radius:12px; padding:12px;">
          <div style="font-weight:800; font-size:13.5px; color:#065F46;">🍽️ ${escHtml(rec.title)}（约 ${totalKcal} kcal）</div>
          <div style="font-size:12px; color:var(--text-sub); margin-top:4px;">${escHtml(rec.desc)}</div>
          <div style="font-size:12.5px; margin-top:8px; color:var(--text-main);">推荐组合：${itemsHtml}</div>
          <button type="button" class="btn btn-primary btn-sm" style="margin-top:9px;" onclick="App.quickLogRecommended()">一键记入今日饮食</button>
        </div>
      `;
    } catch (_) {}
  }

  async function quickLogRecommended() {
    const items = state.lastRecItems || [];
    if (!items.length) return;
    try {
      const payloadItems = items.map((it) => ({
        date: state.todayStr,
        meal_type: 'lunch',
        food_name: it.food_name,
        grams: it.grams,
        calories: it.calories,
        protein_g: it.protein_g,
        carbs_g: it.carbs_g,
        fat_g: it.fat_g,
        source: 'ai_recommend',
      }));
      const res = await api('/api/foods/logs', { method: 'POST', body: { items: payloadItems } });
      state.todayFoods = res.today_foods;
      if (document.getElementById('dietDateInput').value === state.todayStr) {
        state.dietFoods = res.today_foods;
      }
      state.analytics = res.analytics;
      renderAll();
      showToast('已将推荐配餐记入今日饮食！');
    } catch (e) {
      showToast(e.message);
    }
  }

  // ==================== TAB 2: 碳循环排程与营养策略 ====================
  function hydratePlanControls() {
    const p = state.profile;
    if (!p) return;
    setScheduleMode(p.schedule_mode || 'calendar', false);
    setMacroStrategy(p.macro_strategy || 'video_ratio', false);

    const dc = state.plan.day_counts;
    document.getElementById('autoHighDays').value = dc.high;
    document.getElementById('autoMedDays').value = dc.med;
    document.getElementById('autoLowDays').value = dc.low;
    updateAutoSumHint();

    const mc = p.macro_custom_json || {};
    document.getElementById('vHighCarbPct').value = mc.high_carb_pct ?? 80;
    document.getElementById('vHighProtPct').value = mc.high_protein_pct ?? 20;
    document.getElementById('vHighFatCap').value = mc.high_fat_cap_g ?? 10;
    document.getElementById('vLowCarbPct').value = mc.low_carb_pct ?? 30;
    document.getElementById('vLowProtPct').value = mc.low_protein_pct ?? 40;
    document.getElementById('vLowFatPct').value = mc.low_fat_pct ?? 30;

    document.getElementById('rngProtPerKg').value = p.protein_per_kg || 2.0;
    document.getElementById('lblProtPerKg').textContent = `${p.protein_per_kg || 2.0} g/kg`;

    const hOff = p.high_kcal_offset_pct || 0;
    const lOff = p.low_kcal_offset_pct || 0;
    document.getElementById('rngHighOffset').value = hOff;
    document.getElementById('lblHighOffset').textContent = `+${hOff}%`;
    document.getElementById('rngLowOffset').value = lOff;
    document.getElementById('lblLowOffset').textContent = `${lOff}%`;

    document.getElementById('planTargetBf').value = p.target_bf;
    document.getElementById('planDeficit').value = p.calorie_deficit;
    document.getElementById('planCustomBmr').value = p.custom_bmr ?? '';
    document.getElementById('planCustomTargetKcal').value = p.custom_target_kcal ?? '';
  }

  function renderPlanTab() {
    const plan = state.plan;
    const todayIdx = getWeekdayIndex(state.todayStr);
    const shortDays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const shortType = { high: '高碳', med: '中碳', low: '低碳' };

    document.getElementById('planWeekStrip').innerHTML = plan.weekly_plan
      .map(
        (d, idx) => `
        <div class="week-pill type-${d.day_type} ${idx === todayIdx ? 'today' : ''}" onclick="App.cycleSingleDay(${idx})">
          <div class="w-day">${shortDays[idx]}</div>
          <div class="w-tag">${shortType[d.day_type]}</div>
          <div class="w-kcal">${d.carbs_g.toFixed(0)}g碳</div>
        </div>`
      )
      .join('');

    document.getElementById('planAvgVerify').textContent = `7日均热 ${plan.weekly_averages.calories.toFixed(2)} kcal`;

    document.getElementById('planTableBody').innerHTML = plan.weekly_plan
      .map(
        (d) => `
        <tr>
          <td>${d.weekday_name}</td>
          <td><span class="day-badge ${d.day_type}" style="padding:2px 8px; font-size:11px;">${d.label}</span></td>
          <td>${d.calories.toFixed(1)} kcal</td>
          <td style="color:var(--high-carb)">${d.carbs_g.toFixed(2)}g</td>
          <td style="color:var(--keep-green-dark)">${d.protein_g.toFixed(2)}g</td>
          <td>${d.fat_display}</td>
        </tr>`
      )
      .join('');

    const f = plan.formulas;
    const highT = plan.day_type_targets.high;
    const lowT = plan.day_type_targets.low;
    document.getElementById('formulaDisplayBox').innerHTML = `
      <div><strong>📐 透明代谢与营养计算公式核验：</strong></div>
      <code>BMR = ${f.bmr_formula}</code>
      <code>TDEE = ${f.tdee_formula}</code>
      <code>减脂目标热量 = ${f.target_kcal_formula}</code>
      <div style="margin-top:5px;">
        • <strong>高碳日</strong>：碳水 ${highT.carbs_g.toFixed(2)}g · 蛋白质 ${highT.protein_g.toFixed(2)}g · 脂肪 ${highT.fat_display}<br/>
        • <strong>低碳日</strong>：碳水 ${lowT.carbs_g.toFixed(2)}g · 蛋白质 ${lowT.protein_g.toFixed(2)}g · 脂肪 ${lowT.fat_display}
      </div>
    `;

    const warnBox = document.getElementById('planWarnings');
    warnBox.innerHTML = (plan.warnings || [])
      .map((w) => `<div class="notice-box">${w}</div>`)
      .join('');
  }

  function setScheduleMode(mode, persist = true) {
    document.getElementById('modeBtnCalendar').classList.toggle('active', mode === 'calendar');
    document.getElementById('modeBtnAuto').classList.toggle('active', mode === 'auto');
    document.getElementById('autoScheduleBox').style.display = mode === 'auto' ? 'block' : 'none';
    if (persist && state.profile) {
      api('/api/profile', { method: 'POST', body: { schedule_mode: mode } })
        .then((res) => {
          state.profile = res.profile;
        })
        .catch((e) => showToast(e.message));
    }
  }

  function onAutoCountInput(changedField) {
    let h = Math.max(0, Math.min(7, parseInt(document.getElementById('autoHighDays').value || '0', 10)));
    let m = Math.max(0, Math.min(7, parseInt(document.getElementById('autoMedDays').value || '0', 10)));
    let l = Math.max(0, Math.min(7, parseInt(document.getElementById('autoLowDays').value || '0', 10)));

    // 若改动高碳或中碳，自动联动计算剩余低碳天数以方便凑够7天（中碳保持用户设定的0或其他值）
    if (changedField === 'high' || changedField === 'med') {
      if (h + m <= 7) {
        l = 7 - h - m;
        document.getElementById('autoLowDays').value = l;
      }
    }
    updateAutoSumHint();
  }

  function updateAutoSumHint() {
    const h = parseInt(document.getElementById('autoHighDays').value || '0', 10);
    const m = parseInt(document.getElementById('autoMedDays').value || '0', 10);
    const l = parseInt(document.getElementById('autoLowDays').value || '0', 10);
    const sum = h + m + l;
    const el = document.getElementById('autoSumHint');
    el.textContent = `当前合计：${sum} / 7 天（中碳 ${m} 天）`;
    el.style.color = sum === 7 ? 'var(--keep-green-dark)' : 'var(--danger-red)';
  }

  async function applyAutoSchedule() {
    const h = parseInt(document.getElementById('autoHighDays').value || '0', 10);
    const m = parseInt(document.getElementById('autoMedDays').value || '0', 10);
    const l = parseInt(document.getElementById('autoLowDays').value || '0', 10);
    if (h + m + l !== 7) {
      showToast('高碳 + 中碳 + 低碳天数之和必须等于 7 天！');
      return;
    }
    try {
      const res = await api('/api/schedule/auto', {
        method: 'POST',
        body: { high_days: h, med_days: m, low_days: l, persist: true },
      });
      state.profile = res.profile;
      state.plan = res.plan;
      renderAll();
      showToast(`已自动排入周历：${h}高 + ${m}中 + ${l}低！仍可点击单日微调`);
    } catch (e) {
      showToast(e.message);
    }
  }

  async function cycleSingleDay(dayIdx) {
    const order = ['low', 'high', 'med'];
    const cur = [...state.profile.week_schedule_json];
    const nextType = order[(order.indexOf(cur[dayIdx]) + 1) % order.length];
    cur[dayIdx] = nextType;
    await saveWeekSchedule(cur);
  }

  async function applyQuickTemplate(sched) {
    await saveWeekSchedule(sched);
    showToast('已应用碳循环排程模板！');
  }

  async function saveWeekSchedule(sched) {
    try {
      const res = await api('/api/profile', {
        method: 'POST',
        body: { week_schedule_json: sched },
      });
      state.profile = res.profile;
      state.plan = res.plan;
      state.analytics = res.analytics;
      hydratePlanControls();
      renderAll();
    } catch (e) {
      showToast(e.message);
    }
  }

  function setMacroStrategy(strat, persist = true) {
    document.getElementById('stratBtnVideo').classList.toggle('active', strat === 'video_ratio');
    document.getElementById('stratBtnConst').classList.toggle('active', strat === 'constant_protein');
    document.getElementById('videoStrategyPanel').style.display = strat === 'video_ratio' ? 'block' : 'none';
    document.getElementById('constProteinPanel').style.display = strat === 'constant_protein' ? 'block' : 'none';
    if (persist) {
      // 恒定蛋白法如果高低热量偏移都是0，默认给 +15% / -15% 方便体现高低碳热量阶梯，用户也可随时拉回0%
      const extra = {};
      if (
        strat === 'constant_protein' &&
        Number(document.getElementById('rngHighOffset').value) === 0 &&
        Number(document.getElementById('rngLowOffset').value) === 0
      ) {
        document.getElementById('rngHighOffset').value = 15;
        document.getElementById('lblHighOffset').textContent = '+15%';
        document.getElementById('rngLowOffset').value = -15;
        document.getElementById('lblLowOffset').textContent = '-15%';
        extra.high_kcal_offset_pct = 15;
        extra.low_kcal_offset_pct = -15;
      } else if (strat === 'video_ratio') {
        document.getElementById('rngHighOffset').value = 0;
        document.getElementById('lblHighOffset').textContent = '+0%';
        document.getElementById('rngLowOffset').value = 0;
        document.getElementById('lblLowOffset').textContent = '0%';
        extra.high_kcal_offset_pct = 0;
        extra.low_kcal_offset_pct = 0;
      }
      api('/api/profile', { method: 'POST', body: { macro_strategy: strat, ...extra } })
        .then((res) => {
          state.profile = res.profile;
          state.plan = res.plan;
          state.analytics = res.analytics;
          renderAll();
          showToast('已切换营养素计算策略');
        })
        .catch((e) => showToast(e.message));
    }
  }

  async function saveMacroAndOffsetSettings() {
    const isVideo = document.getElementById('stratBtnVideo').classList.contains('active');
    const macroCustom = {
      ...(state.profile.macro_custom_json || {}),
      high_carb_pct: Number(document.getElementById('vHighCarbPct').value || 80),
      high_protein_pct: Number(document.getElementById('vHighProtPct').value || 20),
      high_fat_pct: 0,
      high_fat_cap_g: Number(document.getElementById('vHighFatCap').value || 10),
      low_carb_pct: Number(document.getElementById('vLowCarbPct').value || 30),
      low_protein_pct: Number(document.getElementById('vLowProtPct').value || 40),
      low_fat_pct: Number(document.getElementById('vLowFatPct').value || 30),
    };
    const body = {
      macro_strategy: isVideo ? 'video_ratio' : 'constant_protein',
      protein_per_kg: Number(document.getElementById('rngProtPerKg').value || 2.0),
      high_kcal_offset_pct: Number(document.getElementById('rngHighOffset').value || 0),
      low_kcal_offset_pct: Number(document.getElementById('rngLowOffset').value || 0),
      macro_custom_json: macroCustom,
    };
    try {
      const res = await api('/api/profile', { method: 'POST', body });
      state.profile = res.profile;
      state.plan = res.plan;
      state.analytics = res.analytics;
      renderAll();
      showToast('每日营养分配与偏移已保存！');
    } catch (e) {
      showToast(e.message);
    }
  }

  async function saveMetabolicOverrides() {
    const customBmrRaw = document.getElementById('planCustomBmr').value.trim();
    const customTargetRaw = document.getElementById('planCustomTargetKcal').value.trim();
    const body = {
      target_bf: Number(document.getElementById('planTargetBf').value || 13),
      calorie_deficit: Number(document.getElementById('planDeficit').value || 500),
      custom_bmr: customBmrRaw === '' ? null : Number(customBmrRaw),
      custom_target_kcal: customTargetRaw === '' ? null : Number(customTargetRaw),
    };
    try {
      const res = await api('/api/profile', { method: 'POST', body });
      state.profile = res.profile;
      state.plan = res.plan;
      state.analytics = res.analytics;
      hydrateProfileForm();
      renderAll();
      showToast('代谢目标参数已更新！');
    } catch (e) {
      showToast(e.message);
    }
  }

  async function resetCustomMetabolism() {
    document.getElementById('planCustomBmr').value = '';
    document.getElementById('planCustomTargetKcal').value = '';
    document.getElementById('planDeficit').value = 500;
    await saveMetabolicOverrides();
  }

  // ==================== TAB 3: AI 饮食营养估算与食物库 ====================
  function fillMealSample(txt) {
    document.getElementById('aiFoodTextInput').value = txt;
    runTextFoodAI();
  }

  function getCurrentDietDayLabel() {
    if (!state.plan) return '碳循环减脂日';
    const dStr = document.getElementById('dietDateInput').value || state.todayStr;
    const idx = getWeekdayIndex(dStr);
    const dp = state.plan.weekly_plan[idx];
    return dp ? `${dp.label}（${dp.rule_note}）` : '碳循环减脂日';
  }

  async function runTextFoodAI() {
    const text = document.getElementById('aiFoodTextInput').value.trim();
    if (!text) {
      showToast('请先输入吃了什么食物');
      return;
    }
    const btn = document.getElementById('btnRunFoodText');
    const origTxt = btn.textContent;
    btn.disabled = true;
    btn.textContent = '🤖 AI 分析中...';
    try {
      const res = await api('/api/ai/food-estimate', {
        method: 'POST',
        body: { mode: 'text', text, day_type_label: getCurrentDietDayLabel() },
      });
      showAiFoodPreview(res);
    } catch (e) {
      showToast(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = origTxt;
    }
  }

  function triggerPhotoUpload(target) {
    const idMap = {
      front: 'fileInputFront',
      side: 'fileInputSide',
      back: 'fileInputBack',
      meal: 'fileInputMeal',
    };
    const inputEl = document.getElementById(idMap[target]);
    if (!inputEl) {
      showToast('未找到上传控件');
      return;
    }
    // 每次点击前清空 value，确保重复选择同一张图片也能稳定触发 onchange！
    inputEl.value = '';
    inputEl.click();
  }

  function decodeFileToImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('读取图片文件失败，请重试'));
      reader.onload = (ev) => {
        const rawDataUrl = ev.target.result;
        const img = new Image();
        img.onload = () => resolve({ img, rawDataUrl });
        img.onerror = () => reject(new Error('该图片格式暂不支持（建议使用 JPG / PNG / WebP 照片）'));
        img.src = rawDataUrl;
      };
      reader.readAsDataURL(file);
    });
  }

  async function handleMealPhotoFile(file) {
    if (!file) return;
    showToast('📷 正在读取餐盘照片...');
    try {
      const { img, rawDataUrl } = await decodeFileToImage(file);
      let compressedMealB64 = rawDataUrl;
      let colorStats = { green_ratio: 0.25, warm_ratio: 0.35, white_ratio: 0.25 };

      try {
        const hiCvs = document.createElement('canvas');
        const maxSide = Math.max(1, img.naturalWidth || img.width || 600, img.naturalHeight || img.height || 600);
        const scale = Math.min(1, 768 / maxSide);
        hiCvs.width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
        hiCvs.height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
        hiCvs.getContext('2d').drawImage(img, 0, 0, hiCvs.width, hiCvs.height);
        compressedMealB64 = hiCvs.toDataURL('image/jpeg', 0.83);

        const cvs = document.createElement('canvas');
        cvs.width = 96;
        cvs.height = 96;
        const ctx = cvs.getContext('2d');
        ctx.drawImage(img, 0, 0, 96, 96);
        const data = ctx.getImageData(0, 0, 96, 96).data;
        let green = 0, warm = 0, white = 0;
        const totalPx = 96 * 96;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2];
          if (g > r + 15 && g > b + 15) green++;
          else if (r > 185 && g > 185 && b > 180) white++;
          else if (r > b + 25) warm++;
        }
        colorStats = {
          green_ratio: green / totalPx,
          warm_ratio: warm / totalPx,
          white_ratio: white / totalPx,
        };
      } catch (_) {}

      state.lastMealPhotoBase64 = compressedMealB64;
      state.lastMealColorStats = colorStats;
      document.getElementById('mealPhotoPreviewImg').src = compressedMealB64;
      document.getElementById('mealPhotoPreviewWrap').style.display = 'flex';
      await reAnalyzeLastMealPhoto();
    } catch (err) {
      showToast(err.message || '图片解析失败');
    }
  }

  function onMealPhotoSelected(ev) {
    const file = ev.target && ev.target.files && ev.target.files[0];
    if (!file) return;
    handleMealPhotoFile(file);
  }

  async function reAnalyzeLastMealPhoto() {
    if (!state.lastMealPhotoBase64) return;
    const hint = document.getElementById('aiFoodTextInput').value.trim();
    showToast('🤖 正在识别餐盘食物与营养成分...');
    try {
      const res = await api('/api/ai/food-estimate', {
        method: 'POST',
        body: {
          mode: 'photo',
          hint,
          image_base64: state.lastMealPhotoBase64,
          color_stats: state.lastMealColorStats,
          day_type_label: getCurrentDietDayLabel(),
        },
      });
      showAiFoodPreview(res);
    } catch (err) {
      showToast(err.message);
    }
  }

  function showAiFoodPreview(res) {
    state.aiPendingItems = (res.items || []).map((it) => ({
      ...it,
      per1g_kcal: it.calories / Math.max(1, it.grams),
      per1g_p: it.protein_g / Math.max(1, it.grams),
      per1g_c: it.carbs_g / Math.max(1, it.grams),
      per1g_f: it.fat_g / Math.max(1, it.grams),
    }));
    const box = document.getElementById('aiFoodPreviewBox');
    box.style.display = 'block';

    const badge = document.getElementById('aiFoodEngineBadge');
    const warnEl = document.getElementById('aiFoodFallbackWarn');
    if (res.engine_used === 'cloud_llm') {
      badge.className = 'engine-badge cloud';
      badge.textContent = `✨ 真多模态AI · ${res.model_used || ''}`;
      warnEl.style.display = 'none';
    } else if (res.engine_used === 'local_fallback') {
      badge.className = 'engine-badge local';
      badge.textContent = '⚡ 本地兜底引擎';
      warnEl.style.display = 'block';
      warnEl.textContent = `大模型调用未成功，已自动使用本地引擎估算。原因：${res.fallback_reason || '未知错误'}`;
    } else {
      badge.className = 'engine-badge local';
      badge.textContent = '⚡ 本地营养库引擎（可点右上角配真AI）';
      warnEl.style.display = 'none';
    }

    document.getElementById('aiFoodPreviewNote').textContent = res.note || '';
    renderAiPendingList();
  }

  function renderAiPendingList() {
    const listEl = document.getElementById('aiFoodPreviewList');
    listEl.innerHTML = state.aiPendingItems
      .map(
        (it, idx) => `
        <div class="food-item" style="padding:7px 0;">
          <div>
            <div class="food-title">${escHtml(it.food_name)}</div>
            <div class="food-meta">${it.calories.toFixed(0)} kcal · 碳${it.carbs_g.toFixed(1)}g 蛋${it.protein_g.toFixed(1)}g 脂${it.fat_g.toFixed(1)}g</div>
          </div>
          <div style="display:flex; align-items:center; gap:5px;">
            <input type="number" class="input" style="width:72px; padding:5px 7px;" value="${it.grams}" min="5" step="10"
              onchange="App.updatePendingGrams(${idx}, this.value)" />
            <span style="font-size:12px;">g</span>
          </div>
        </div>`
      )
      .join('');
  }

  function updatePendingGrams(idx, newGrams) {
    const g = Math.max(1, Number(newGrams || 100));
    const it = state.aiPendingItems[idx];
    if (!it) return;
    it.grams = g;
    it.calories = Math.round(it.per1g_kcal * g * 10) / 10;
    it.protein_g = Math.round(it.per1g_p * g * 100) / 100;
    it.carbs_g = Math.round(it.per1g_c * g * 100) / 100;
    it.fat_g = Math.round(it.per1g_f * g * 100) / 100;
    renderAiPendingList();
  }

  async function commitAiFoodItems() {
    if (!state.aiPendingItems.length) return;
    const dateStr = document.getElementById('dietDateInput').value || state.todayStr;
    const mealType = document.getElementById('dietMealType').value;
    const items = state.aiPendingItems.map((it) => ({
      date: dateStr,
      meal_type: mealType,
      food_name: it.food_name,
      grams: it.grams,
      calories: it.calories,
      protein_g: it.protein_g,
      carbs_g: it.carbs_g,
      fat_g: it.fat_g,
      source: 'ai_estimate',
    }));
    try {
      const res = await api('/api/foods/logs', { method: 'POST', body: { items } });
      state.dietFoods = res.today_foods;
      if (dateStr === state.todayStr) state.todayFoods = res.today_foods;
      state.analytics = res.analytics;
      document.getElementById('aiFoodPreviewBox').style.display = 'none';
      document.getElementById('aiFoodTextInput').value = '';
      renderAll();
      showToast('已记入饮食记录！');
    } catch (e) {
      showToast(e.message);
    }
  }

  function setFoodCategory(cat, el) {
    state.foodCategory = cat;
    document.querySelectorAll('#foodCatChips .chip').forEach((c) => c.classList.remove('active'));
    if (el) el.classList.add('active');
    searchFoodLibrary();
  }

  async function searchFoodLibrary() {
    const q = document.getElementById('foodSearchInput').value.trim();
    try {
      const res = await api(`/api/foods/search?q=${encodeURIComponent(q)}&category=${state.foodCategory}`);
      state.currentSearchFoods = res.foods || [];
    } catch (e) {
      showToast(e.message);
      return;
    }
    const listEl = document.getElementById('foodLibraryList');
    const tagMap = {
      high_friendly: '<span style="color:#FF6B35;font-weight:700;">[高碳优选]</span>',
      low_friendly: '<span style="color:#16B981;font-weight:700;">[低碳友好]</span>',
      balanced: '<span style="color:#3B82F6;">[均衡]</span>',
    };
    if (!state.currentSearchFoods.length) {
      listEl.innerHTML = `<div style="text-align:center; padding:16px 0; color:var(--text-muted); font-size:12.5px;">未找到匹配食物，可在上方输入框直接用 AI 估算任意菜品</div>`;
      return;
    }
    listEl.innerHTML = state.currentSearchFoods
      .map(
        (f, idx) => `
        <div class="food-item">
          <div>
            <div class="food-title">${f.name} ${tagMap[f.tag] || ''}</div>
            <div class="food-meta">每100g: ${f.kcal}kcal | 碳${f.carbs}g 蛋${f.protein}g 脂${f.fat}g · 1${f.unit_name}≈${f.unit_grams}g</div>
          </div>
          <button type="button" class="btn btn-outline btn-sm" onclick="App.openAddFoodModal(${idx})">+ 添加</button>
        </div>`
      )
      .join('');
  }

  function openAddFoodModal(idx) {
    const food = state.currentSearchFoods[idx];
    if (!food) return;
    state.addingFoodItem = food;
    const defaultG = food.unit_grams || 100;
    document.getElementById('addFoodTitle').textContent = `添加「${food.name}」`;
    document.getElementById('addFoodSubMeta').textContent =
      `每100g含 ${food.kcal} kcal（碳水 ${food.carbs}g · 蛋白质 ${food.protein}g · 脂肪 ${food.fat}g）｜常规 1${food.unit_name} ≈ ${defaultG}g`;

    const portions = [
      { lbl: `半${food.unit_name} (${Math.round(defaultG * 0.5)}g)`, g: Math.round(defaultG * 0.5) },
      { lbl: `1${food.unit_name} (${defaultG}g)`, g: defaultG },
      { lbl: `1.5${food.unit_name} (${Math.round(defaultG * 1.5)}g)`, g: Math.round(defaultG * 1.5) },
      { lbl: `2${food.unit_name} (${defaultG * 2}g)`, g: defaultG * 2 },
      { lbl: '100g 标准份', g: 100 },
    ];
    document.getElementById('addFoodPortionChips').innerHTML = portions
      .map((p) => `<span class="chip" onclick="App.setModalGrams(${p.g})">${p.lbl}</span>`)
      .join('');

    document.getElementById('addFoodGramsInput').value = defaultG;
    updateAddFoodCalc();
    document.getElementById('foodAddModal').classList.add('open');
  }

  function closeAddFoodModal() {
    document.getElementById('foodAddModal').classList.remove('open');
  }

  function setModalGrams(g) {
    document.getElementById('addFoodGramsInput').value = Math.max(1, Number(g) || 100);
    updateAddFoodCalc();
  }

  function stepModalGrams(delta) {
    const cur = Number(document.getElementById('addFoodGramsInput').value || 100);
    document.getElementById('addFoodGramsInput').value = Math.max(5, cur + delta);
    updateAddFoodCalc();
  }

  function updateAddFoodCalc() {
    const f = state.addingFoodItem;
    if (!f) return;
    const g = Math.max(1, Number(document.getElementById('addFoodGramsInput').value || 100));
    const fac = g / 100;
    const kcal = (f.kcal * fac).toFixed(0);
    const c = (f.carbs * fac).toFixed(1);
    const p = (f.protein * fac).toFixed(1);
    const fat = (f.fat * fac).toFixed(1);
    document.getElementById('addFoodLiveCalc').innerHTML =
      `📊 当前份量营养：<strong>${kcal} kcal</strong>（碳水 ${c}g · 蛋白质 ${p}g · 脂肪 ${fat}g）`;
  }

  async function confirmAddDbFood() {
    const food = state.addingFoodItem;
    if (!food) return;
    const grams = Math.max(1, Number(document.getElementById('addFoodGramsInput').value) || food.unit_grams || 100);
    const factor = grams / 100;
    const dateStr = document.getElementById('dietDateInput').value || state.todayStr;
    const mealType = document.getElementById('dietMealType').value;

    try {
      const res = await api('/api/foods/logs', {
        method: 'POST',
        body: {
          date: dateStr,
          meal_type: mealType,
          food_name: food.name,
          grams,
          calories: food.kcal * factor,
          protein_g: food.protein * factor,
          carbs_g: food.carbs * factor,
          fat_g: food.fat * factor,
          source: 'database',
        },
      });
      state.dietFoods = res.today_foods;
      if (dateStr === state.todayStr) state.todayFoods = res.today_foods;
      state.analytics = res.analytics;
      closeAddFoodModal();
      renderAll();
      showToast(`✅ 已添加 ${grams}g ${food.name}`);
    } catch (err) {
      showToast(err.message);
    }
  }

  async function loadDietForDate(dateStr) {
    try {
      const res = await api(`/api/foods/logs?date=${dateStr}`);
      state.dietFoods = res.logs || [];
      if (dateStr === state.todayStr) state.todayFoods = state.dietFoods;
      renderDietLogged();
    } catch (e) {
      showToast(e.message);
    }
  }

  function renderDietLogged() {
    const listEl = document.getElementById('dietLoggedList');
    const logs = state.dietFoods || [];
    const totalKcal = logs.reduce((s, i) => s + Number(i.calories || 0), 0);
    const totalC = logs.reduce((s, i) => s + Number(i.carbs_g || 0), 0);
    const totalP = logs.reduce((s, i) => s + Number(i.protein_g || 0), 0);
    const totalF = logs.reduce((s, i) => s + Number(i.fat_g || 0), 0);

    document.getElementById('dietDaySummaryTxt').textContent =
      `${totalKcal.toFixed(0)} kcal (碳${totalC.toFixed(0)}g/蛋${totalP.toFixed(0)}g/脂${totalF.toFixed(0)}g)`;

    if (!logs.length) {
      listEl.innerHTML = `<div style="text-align:center; padding:18px 0; color:var(--text-muted); font-size:12.5px;">当日暂无饮食记录，可用上方 AI 估算或食物库添加</div>`;
      return;
    }

    listEl.innerHTML = logs
      .map(
        (item) => `
        <div class="food-item">
          <div>
            <div class="food-title"><span style="font-size:11.5px; color:var(--keep-green-dark); margin-right:5px;">${MEAL_LABELS[item.meal_type] || '餐食'}</span>${escHtml(item.food_name)} (${item.grams}g)</div>
            <div class="food-meta">${item.calories} kcal · 碳水 ${item.carbs_g}g · 蛋白质 ${item.protein_g}g · 脂肪 ${item.fat_g}g</div>
          </div>
          <button class="btn btn-outline btn-sm" style="color:var(--danger-red);" onclick="App.removeFoodLog(${item.id})">删除</button>
        </div>`
      )
      .join('');
  }

  async function removeFoodLog(id) {
    const dateStr = document.getElementById('dietDateInput').value || state.todayStr;
    try {
      const res = await api(`/api/foods/logs/${id}`, { method: 'DELETE' });
      state.analytics = res.analytics;
      await loadDietForDate(dateStr);
      renderHome();
      showToast('已删除饮食记录');
    } catch (e) {
      showToast(e.message);
    }
  }

  // ==================== TAB 4: 每日打卡与趋势可视化 ====================
  function selectBodyState(val, el) {
    state.bodyStateSelected = val;
    document.querySelectorAll('#bodyStateChips .chip').forEach((c) => c.classList.remove('active'));
    if (el) el.classList.add('active');
  }

  function loadCheckinForDate(dateStr) {
    document.getElementById('checkinDate').value = dateStr;
    const found = (state.checkins || []).find((c) => c.date === dateStr);
    if (found) {
      document.getElementById('chkWeight').value = found.weight_kg ?? '';
      document.getElementById('chkWaist').value = found.waist_cm ?? '';
      document.getElementById('chkHip').value = found.hip_cm ?? '';
      document.getElementById('chkBf').value = found.body_fat_pct ?? '';
      document.getElementById('chkSleep').value = found.sleep_hours ?? 7.5;
      document.getElementById('chkWorkout').value = found.workout_done || 'rest';
      document.getElementById('chkPerf').value = found.workout_performance ?? 4;
      document.getElementById('chkHunger').value = found.hunger_level ?? 2;
      document.getElementById('chkNotes').value = found.notes || '';
      state.bodyStateSelected = found.body_state || '状态平稳';
      document.querySelectorAll('#bodyStateChips .chip').forEach((c) => {
        c.classList.toggle('active', c.textContent === state.bodyStateSelected);
      });
    } else if (state.profile) {
      document.getElementById('chkWeight').value = state.profile.weight_kg || '';
      document.getElementById('chkWaist').value = state.profile.waist_cm || '';
      document.getElementById('chkHip').value = state.profile.hip_cm || '';
      document.getElementById('chkBf').value = '';
      document.getElementById('chkSleep').value = 7.5;
      document.getElementById('chkWorkout').value = 'strength_cardio';
      document.getElementById('chkPerf').value = 4;
      document.getElementById('chkHunger').value = 2;
      document.getElementById('chkNotes').value = '';
      state.bodyStateSelected = '精力充沛';
      document.querySelectorAll('#bodyStateChips .chip').forEach((c) => {
        c.classList.toggle('active', c.textContent === state.bodyStateSelected);
      });
    }
  }

  async function submitCheckin() {
    const w = document.getElementById('chkWeight').value;
    if (!w) {
      showToast('请填写今日体重(kg)');
      return;
    }
    const payload = {
      date: document.getElementById('checkinDate').value || state.todayStr,
      weight_kg: Number(w),
      waist_cm: document.getElementById('chkWaist').value || null,
      hip_cm: document.getElementById('chkHip').value || null,
      body_fat_pct: document.getElementById('chkBf').value || null,
      sleep_hours: document.getElementById('chkSleep').value || null,
      workout_done: document.getElementById('chkWorkout').value,
      workout_performance: Number(document.getElementById('chkPerf').value),
      hunger_level: Number(document.getElementById('chkHunger').value),
      body_state: state.bodyStateSelected,
      notes: document.getElementById('chkNotes').value.trim(),
      sync_profile_weight: document.getElementById('chkSyncWeight').checked,
    };
    try {
      const res = await api('/api/checkins', { method: 'POST', body: payload });
      state.checkins = res.checkins;
      state.profile = res.profile;
      state.plan = res.plan;
      state.analytics = res.analytics;
      hydrateProfileForm();
      renderAll();
      showToast('打卡成功！减脂趋势图已更新');
    } catch (e) {
      showToast(e.message);
    }
  }

  function renderCheckinHistory() {
    const box = document.getElementById('checkinHistoryList');
    const list = [...(state.checkins || [])].reverse();
    if (!list.length) {
      box.innerHTML = `<div style="text-align:center; padding:16px 0; color:var(--text-muted); font-size:12.5px;">暂无历史打卡，完成上方首次打卡即可追踪变化</div>`;
      return;
    }
    box.innerHTML = list
      .slice(0, 30)
      .map(
        (c) => `
        <div class="food-item" style="cursor:pointer;" onclick="App.editHistoryCheckin('${c.date}')">
          <div>
            <div class="food-title">${escHtml(c.date)} · 体重 <strong>${c.weight_kg ?? '--'}kg</strong> ${c.waist_cm ? `· 腰围 ${c.waist_cm}cm` : ''} ${c.body_fat_pct ? `· 体脂 ${c.body_fat_pct}%` : ''}</div>
            <div class="food-meta">${WORKOUT_LABELS[c.workout_done] || escHtml(c.workout_done)} · 表现${c.workout_performance}分 · 饥饿${c.hunger_level}级 · ${escHtml(c.body_state || '')} ${c.notes ? '｜' + escHtml(c.notes) : ''}</div>
          </div>
          <button class="btn btn-outline btn-sm" onclick="event.stopPropagation(); App.removeCheckin('${c.date}')">删除</button>
        </div>`
      )
      .join('');
  }

  function editHistoryCheckin(dateStr) {
    loadCheckinForDate(dateStr);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    showToast(`已载入 ${dateStr} 打卡数据，修改后点击保存即可`);
  }

  async function removeCheckin(dateStr) {
    try {
      const res = await api(`/api/checkins/${encodeURIComponent(dateStr)}`, { method: 'DELETE' });
      state.checkins = res.checkins;
      state.analytics = res.analytics;
      renderAll();
      showToast(`已删除 ${dateStr} 打卡记录`);
    } catch (e) {
      showToast(e.message);
    }
  }

  function setChartRange(days, el) {
    state.chartRangeDays = days;
    document.querySelectorAll('#chartRangeChips .chip').forEach((c) => c.classList.remove('active'));
    if (el) el.classList.add('active');
    renderAllCharts();
  }

  async function seedDemoData() {
    try {
      const res = await api('/api/demo/seed', { method: 'POST', body: { days: 14, date: state.todayStr } });
      state.checkins = res.checkins;
      state.todayFoods = res.today_foods;
      state.analytics = res.analytics;
      const dietDate = document.getElementById('dietDateInput').value || state.todayStr;
      if (dietDate === state.todayStr) state.dietFoods = res.today_foods;
      else await loadDietForDate(dietDate);
      loadCheckinForDate(state.todayStr);
      renderAll();
      showToast('已生成近14天碳循环打卡与饮食趋势样本！');
    } catch (e) {
      showToast(e.message);
    }
  }

  async function clearDemoData() {
    try {
      const res = await api('/api/demo/clear', { method: 'POST', body: { only_demo: true, date: state.todayStr } });
      state.checkins = res.checkins;
      state.todayFoods = res.today_foods;
      state.analytics = res.analytics;
      const dietDate = document.getElementById('dietDateInput').value || state.todayStr;
      if (dietDate === state.todayStr) state.dietFoods = res.today_foods;
      else await loadDietForDate(dietDate);
      loadCheckinForDate(state.todayStr);
      renderAll();
      showToast('已清空样本数据（您的真实打卡与饮食已保留）');
    } catch (e) {
      showToast(e.message);
    }
  }

  function renderAllCharts() {
    if (!state.analytics) return;
    const range = state.chartRangeDays;
    const series = (state.analytics.series || []).slice(-range);
    const nutri = (state.analytics.nutrition_series || []).slice(-range);
    const weeklySpeed = state.analytics.weekly_speed || [];

    // 1. 体重曲线 + 7日移动均线
    CarbCharts.renderLineChart(document.getElementById('chartWeight'), {
      labels: series.map((s) => s.date),
      unit: 'kg',
      targetLine: state.analytics.ideal_target_weight_kg,
      targetLabel: '参考目标',
      targetColor: '#F59E0B',
      lines: [
        { values: series.map((s) => s.weight_kg), color: '#24C789', width: 2.5, area: true },
        { values: series.map((s) => s.moving_avg_7d), color: '#181B24', width: 2.0, dashed: true, area: false },
      ],
    });

    // 2. 腰围 & 臀围变化曲线
    CarbCharts.renderLineChart(document.getElementById('chartWaist'), {
      labels: series.map((s) => s.date),
      unit: 'cm',
      lines: [
        { values: series.map((s) => s.waist_cm), color: '#3B82F6', fillTop: 'rgba(59,130,246,0.18)', width: 2.4 },
        { values: series.map((s) => s.hip_cm), color: '#8B5CF6', width: 2.0, dashed: true, area: false },
      ],
    });

    // 3. 体脂率趋势
    CarbCharts.renderLineChart(document.getElementById('chartBf'), {
      labels: series.map((s) => s.date),
      unit: '%',
      targetLine: state.analytics.target_bf,
      targetLabel: '目标体脂',
      targetColor: '#10B981',
      lines: [
        { values: series.map((s) => s.body_fat_pct), color: '#FF6B35', fillTop: 'rgba(255,107,53,0.2)', width: 2.5 },
      ],
    });

    // 4. 每周减重速度
    CarbCharts.renderBarChart(document.getElementById('chartWeeklySpeed'), {
      labels: weeklySpeed.map((w) => w.week_label),
      values: weeklySpeed.map((w) => w.loss_kg),
      barColors: weeklySpeed.map((w) => (w.loss_kg >= 0 ? '#24C789' : '#EF4444')),
      refLine: state.analytics.expected_weekly_loss_kg,
      emptyText: '至少需要跨2个日期的体重打卡才能计算周减重速度',
    });

    // 5. 每日热量摄入 vs 当日碳循环目标热量
    const loggedNutri = nutri.filter((n) => n.calories > 0);
    const colorByType = { high: '#FF6B35', med: '#3B82F6', low: '#16B981' };
    CarbCharts.renderBarChart(document.getElementById('chartCalories'), {
      labels: loggedNutri.map((n) => n.date),
      values: loggedNutri.map((n) => n.calories),
      barColors: loggedNutri.map((n) => colorByType[n.day_type] || '#24C789'),
      targetSeries: loggedNutri.map((n) => n.target_calories),
      emptyText: '记录每日三餐饮食后自动展示热量摄入对比',
    });

    // 6. 每日三大营养素堆叠柱状图
    CarbCharts.renderStackedMacrosChart(document.getElementById('chartMacros'), {
      items: loggedNutri,
      emptyText: '记录饮食后自动展示每日碳水/蛋白/脂肪摄入构成',
    });
  }

  // ==================== TAB 5: 身体档案与三视图本地视觉 AI 评估 ====================
  function hydrateProfileForm() {
    const p = state.profile;
    if (!p) return;
    document.getElementById('profNickname').value = p.nickname || '减脂进阶者';
    document.getElementById('profGender').value = p.gender || 'male';
    document.getElementById('profHeight').value = p.height_cm;
    document.getElementById('profWeight').value = p.weight_kg;
    document.getElementById('profAge').value = p.age;
    document.getElementById('profWaist').value = p.waist_cm ?? '';
    document.getElementById('profActivity').value = p.activity_level || 'light';
    document.getElementById('profMultiplier').value = p.activity_multiplier || 1.375;
    document.getElementById('profWorkouts').value = p.weekly_workouts ?? 4;
    document.getElementById('profWorkoutType').value = p.workout_type || 'strength_cardio';
    document.getElementById('profCurrentBf').value = p.current_bf;
    document.getElementById('profTargetBf').value = p.target_bf;
    document.getElementById('profDeficit').value = p.calorie_deficit || 500;
    document.getElementById('lblProfDeficit').textContent = `${p.calorie_deficit || 500} kcal`;

    // 恢复已上传的身体照片预览（兼容后端 /uploads/ 路径与独立 APK 内的 Base64 DataURL）
    ['front', 'side', 'back'].forEach((v) => {
      const url = p[`${v}_photo`];
      if (!url) {
        renderPhotoSlotPreview(v, null);
        return;
      }
      if (String(url).startsWith('data:image')) {
        state.photosBase64[v] = url;
        renderPhotoSlotPreview(v, url);
      } else if (!state.offlineMode) {
        renderPhotoSlotPreview(v, url);
      } else {
        renderPhotoSlotPreview(v, null);
      }
    });
    if (p.ai_assessment_json) {
      renderAiBodyFatReport(p.ai_assessment_json);
    }
  }

  function onActivityLevelChange(level) {
    const mult = ACTIVITY_MULTIPLIERS[level] || 1.375;
    document.getElementById('profMultiplier').value = mult;
  }

  function fillBaselineDemoProfile() {
    document.getElementById('profGender').value = 'male';
    document.getElementById('profHeight').value = 186;
    document.getElementById('profWeight').value = 80;
    document.getElementById('profAge').value = 20;
    document.getElementById('profWaist').value = 82;
    document.getElementById('profActivity').value = 'light';
    document.getElementById('profMultiplier').value = 1.375;
    document.getElementById('profDeficit').value = 500;
    document.getElementById('lblProfDeficit').textContent = '500 kcal';
    showToast('已填入 男｜186cm｜80kg｜20岁｜1.375 基准档案，点击底部保存即可验证！');
  }

  function renderPhotoSlotPreview(view, srcUrl) {
    const slotMap = { front: 'slotFront', side: 'slotSide', back: 'slotBack' };
    const emptyIcon = { front: '🧍', side: '🚶', back: '🏋️' };
    const emptyLabel = { front: '点击上传正面照', side: '点击上传侧面照', back: '点击上传背面照' };
    const readyLabel = { front: '正面照 · 点击更换', side: '侧面照 · 点击更换', back: '背面照 · 点击更换' };
    const slot = document.getElementById(slotMap[view]);
    if (!slot) return;

    if (!srcUrl) {
      slot.innerHTML = `
        <span style="font-size:24px;">${emptyIcon[view]}</span>
        <span class="photo-slot-label">${emptyLabel[view]}</span>
      `;
      return;
    }

    slot.innerHTML = `
      <img src="${srcUrl}" alt="${view}" />
      <button type="button" class="photo-remove-btn" title="移除此照片" onclick="event.stopPropagation(); App.removeBodyPhoto('${view}')">×</button>
      <span class="photo-slot-tag">${readyLabel[view]}</span>
    `;
  }

  async function removeBodyPhoto(view) {
    state.photosBase64[view] = null;
    state.photoFeatures[view] = null;
    renderPhotoSlotPreview(view, null);
    try {
      const res = await api('/api/photos/delete', { method: 'POST', body: { view } });
      if (res.profile) state.profile = res.profile;
      showToast('已移除该照片');
    } catch (_) {}
  }

  function onSlotDragOver(ev, el) {
    ev.preventDefault();
    if (el) el.classList.add('dragover');
  }

  function onSlotDragLeave(ev, el) {
    if (el) el.classList.remove('dragover');
  }

  function onSlotDrop(ev, view, el) {
    ev.preventDefault();
    if (el) el.classList.remove('dragover');
    const file = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (file) handleBodyPhotoFile(view, file);
  }

  function extractCanvasBodyFeatures(imgEl) {
    const cvs = document.createElement('canvas');
    cvs.width = 96;
    cvs.height = 128;
    const ctx = cvs.getContext('2d');
    ctx.drawImage(imgEl, 0, 0, 96, 128);
    const imgData = ctx.getImageData(0, 0, 96, 128).data;

    let lumSum = 0;
    let lumSqSum = 0;
    let edgeHits = 0;
    const gray = new Float32Array(96 * 128);

    for (let i = 0, px = 0; i < imgData.length; i += 4, px++) {
      const l = 0.299 * imgData[i] + 0.587 * imgData[i + 1] + 0.114 * imgData[i + 2];
      gray[px] = l;
      lumSum += l;
      lumSqSum += l * l;
    }

    // 计算中心躯干区域（x: 24..72, y: 32..96）的水平/垂直梯度密度（反映肌肉线条阴影）
    let torsoCount = 0;
    for (let y = 32; y < 96; y++) {
      for (let x = 24; x < 72; x++) {
        const idx = y * 96 + x;
        const gx = Math.abs(gray[idx + 1] - gray[idx - 1]);
        const gy = Math.abs(gray[idx + 96] - gray[idx - 96]);
        if (gx + gy > 26) edgeHits++;
        torsoCount++;
      }
    }

    const n = 96 * 128;
    const mean = lumSum / n;
    const std = Math.sqrt(Math.max(0, lumSqSum / n - mean * mean));

    return {
      brightness: Math.round(mean * 10) / 10,
      contrast: Math.round((std / 128) * 1000) / 1000,
      edge_density: Math.round((edgeHits / Math.max(1, torsoCount)) * 1000) / 1000,
    };
  }

  async function handleBodyPhotoFile(view, file) {
    if (!file) return;
    const viewName = view === 'front' ? '正面' : view === 'side' ? '侧面' : '背面';
    showToast(`📷 正在处理${viewName}照片...`);
    try {
      const { img, rawDataUrl } = await decodeFileToImage(file);
      let compressedDataUrl = rawDataUrl;
      try {
        const compressCvs = document.createElement('canvas');
        const maxSide = Math.max(1, img.naturalWidth || img.width || 520, img.naturalHeight || img.height || 520);
        const scale = Math.min(1, 640 / maxSide);
        compressCvs.width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
        compressCvs.height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
        compressCvs.getContext('2d').drawImage(img, 0, 0, compressCvs.width, compressCvs.height);
        compressedDataUrl = compressCvs.toDataURL('image/jpeg', 0.84);
        state.photoFeatures[view] = extractCanvasBodyFeatures(img);
      } catch (_) {
        state.photoFeatures[view] = { brightness: 145, contrast: 0.23, edge_density: 0.15 };
      }

      state.photosBase64[view] = compressedDataUrl;
      renderPhotoSlotPreview(view, compressedDataUrl);

      // 选图后立即持久化保存到后端数据库，防止刷新丢失！
      const upRes = await api('/api/photos/upload', {
        method: 'POST',
        body: { view, data_url: compressedDataUrl },
      });
      if (upRes && upRes.profile) {
        state.profile = upRes.profile;
      }
      showToast(`✅ ${viewName}照片上传并保存成功！`);
    } catch (err) {
      showToast(err.message || `${viewName}照片上传失败`);
    }
  }

  function onBodyPhotoChange(view, ev) {
    const file = ev.target && ev.target.files && ev.target.files[0];
    if (!file) return;
    handleBodyPhotoFile(view, file);
  }

  function generateMockBodyPhotos() {
    const views = [
      { key: 'front', title: '正面轮廓示意', waistW: 44, shW: 62 },
      { key: 'side', title: '侧面厚度示意', waistW: 30, shW: 34 },
      { key: 'back', title: '背面V字示意', waistW: 42, shW: 66 },
    ];
    views.forEach((v) => {
      const cvs = document.createElement('canvas');
      cvs.width = 240;
      cvs.height = 320;
      const ctx = cvs.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, 0, 320);
      g.addColorStop(0, '#E9EEF6');
      g.addColorStop(1, '#D5DFEC');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 240, 320);

      // 绘制人体剪影与腹部阴影参考线
      ctx.fillStyle = '#334155';
      ctx.beginPath();
      ctx.arc(120, 56, 24, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(120 - v.shW, 92);
      ctx.lineTo(120 + v.shW, 92);
      ctx.lineTo(120 + v.waistW, 205);
      ctx.lineTo(120 + v.waistW + 6, 300);
      ctx.lineTo(120 - v.waistW - 6, 300);
      ctx.lineTo(120 - v.waistW, 205);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(120, 115);
      ctx.lineTo(120, 195);
      ctx.stroke();

      ctx.fillStyle = '#0F172A';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(v.title, 120, 26);

      const url = cvs.toDataURL('image/jpeg', 0.85);
      state.photosBase64[v.key] = url;
      state.photoFeatures[v.key] = { brightness: 152, contrast: 0.24, edge_density: 0.15 };
      renderPhotoSlotPreview(v.key, url);
    });
    runBodyFatAI();
  }

  async function runBodyFatAI() {
    const btn = document.getElementById('btnRunBodyFat');
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '🤖 正在调用视觉 AI 深度评估三视图...';

    const payload = {
      gender: document.getElementById('profGender').value,
      age: Number(document.getElementById('profAge').value || 20),
      height_cm: Number(document.getElementById('profHeight').value || 186),
      weight_kg: Number(document.getElementById('profWeight').value || 80),
      waist_cm: document.getElementById('profWaist').value || null,
      weekly_workouts: Number(document.getElementById('profWorkouts').value || 3),
      workout_type: document.getElementById('profWorkoutType').value,
      photo_features: state.photoFeatures,
      photos_base64: state.photosBase64,
      save_to_profile: true,
    };
    try {
      const res = await api('/api/ai/body-fat', { method: 'POST', body: payload });
      const a = res.assessment;
      renderAiBodyFatReport(a);
      document.getElementById('profCurrentBf').value = a.estimated_bf;
      showToast(`AI 评估完成：约 ${a.estimated_bf}% (${a.range_min}%~${a.range_max}%)，可在下方手动微调`);
    } catch (e) {
      showToast(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  }

  function renderAiBodyFatReport(a) {
    if (!a) return;
    document.getElementById('aiBfResultCard').style.display = 'block';
    document.getElementById('aiBfCenterVal').textContent = a.estimated_bf;
    document.getElementById('aiBfRangeTxt').textContent = `(合理区间 ${a.range_min}% ~ ${a.range_max}%)`;
    document.getElementById('aiBfStageTag').textContent = a.stage_desc || '体态评估完成';

    const engineBadge = document.getElementById('aiBfEngineBadge');
    if (a.engine_used === 'cloud_llm') {
      engineBadge.className = 'engine-badge cloud';
      engineBadge.textContent = `✨ 真多模态视觉AI · ${a.model_used || ''}`;
    } else if (a.engine_used === 'local_fallback') {
      engineBadge.className = 'engine-badge local';
      engineBadge.textContent = '⚡ 本地算法兜底（大模型调用失败）';
    } else {
      engineBadge.className = 'engine-badge local';
      engineBadge.textContent = '⚡ 本地模型估算（可配置真AI密钥）';
    }

    const vb = a.visual_breakdown || {};
    const fallbackHtml = a.fallback_reason
      ? `<div style="color:#B45309; margin-bottom:4px;">⚠️ 真实接口异常已自动兜底：${escHtml(a.fallback_reason)}</div>`
      : '';
    document.getElementById('aiBfBreakdown').innerHTML = `
      ${fallbackHtml}
      <div>• <strong>评估置信度</strong>：${escHtml(a.confidence_label || '--')}</div>
      <div>• <strong>正面分析</strong>：${escHtml(vb.front || '')}</div>
      <div>• <strong>侧面分析</strong>：${escHtml(vb.side || '')}</div>
      <div>• <strong>背面分析</strong>：${escHtml(vb.back || '')}</div>
    `;

    const adviceEl = document.getElementById('aiBfAdviceBox');
    if (a.advice) {
      adviceEl.style.display = 'block';
      adviceEl.textContent = `💡 专属建议：${a.advice}`;
    } else {
      adviceEl.style.display = 'none';
    }

    document.getElementById('aiBfDisclaimer').textContent = a.disclaimer || '';
  }

  // ==================== 多模态大模型 API 配置中心 ====================
  function updateHeaderAiBadge() {
    const cfg = state.aiSettings;
    const dot = document.getElementById('aiStatusDot');
    const txt = document.getElementById('aiStatusText');
    if (!dot || !txt) return;
    if (cfg && cfg.enabled && cfg.has_key) {
      dot.classList.add('online');
      txt.textContent = '真AI已启用';
    } else {
      dot.classList.remove('online');
      txt.textContent = '配置真AI';
    }
  }

  async function openAiModal() {
    try {
      const cfg = await api('/api/ai/settings');
      state.aiSettings = cfg;
      document.getElementById('aiCfgEnabled').checked = Boolean(cfg.enabled);
      document.getElementById('aiCfgProvider').value = cfg.provider || 'zhipu';
      document.getElementById('aiCfgBaseUrl').value = cfg.base_url || '';
      document.getElementById('aiCfgModel').value = cfg.model_name || '';
      document.getElementById('aiCfgApiKey').value = '';
      document.getElementById('aiCfgFallback').checked = Boolean(cfg.auto_fallback);
      document.getElementById('aiSavedKeyHint').textContent = cfg.has_key
        ? `✅ 已保存密钥 (${cfg.masked_key})`
        : '尚未填写 API Key';
      document.getElementById('aiTestResultBox').style.display = 'none';
      renderProviderMeta(cfg.provider || 'zhipu', false);
      document.getElementById('aiConfigModal').classList.add('open');
    } catch (e) {
      showToast(e.message);
    }
  }

  function closeAiModal() {
    document.getElementById('aiConfigModal').classList.remove('open');
  }

  function renderProviderMeta(providerKey, overwriteFields = true) {
    const providers = (state.aiSettings && state.aiSettings.providers) || {};
    const meta = providers[providerKey];
    if (!meta) return;
    document.getElementById('aiProviderGuide').innerHTML = `<strong>💡 平台说明：</strong>${meta.guide}`;
    if (overwriteFields) {
      document.getElementById('aiCfgBaseUrl').value = meta.base_url;
      document.getElementById('aiCfgModel').value = meta.default_model;
    }
    const chipsBox = document.getElementById('aiModelQuickChips');
    chipsBox.innerHTML = (meta.models || [])
      .map((m) => `<span class="chip" onclick="App.selectQuickModel('${m}')">${m}</span>`)
      .join('');
  }

  function onAiProviderChange(prov) {
    renderProviderMeta(prov, true);
  }

  function selectQuickModel(modelName) {
    document.getElementById('aiCfgModel').value = modelName;
  }

  async function testAiConnection() {
    const btn = document.getElementById('btnTestAiConn');
    const resBox = document.getElementById('aiTestResultBox');
    btn.disabled = true;
    btn.textContent = '连接测试中...';
    resBox.style.display = 'block';
    resBox.style.background = '#F1F5F9';
    resBox.style.color = '#334155';
    resBox.textContent = '正在向多模态大模型发送握手请求，请稍候...';

    try {
      const res = await api('/api/ai/test', {
        method: 'POST',
        body: {
          provider: document.getElementById('aiCfgProvider').value,
          base_url: document.getElementById('aiCfgBaseUrl').value.trim(),
          model_name: document.getElementById('aiCfgModel').value.trim(),
          api_key: document.getElementById('aiCfgApiKey').value.trim(),
        },
      });
      resBox.style.background = '#ECFDF5';
      resBox.style.color = '#065F46';
      resBox.innerHTML = `✅ <strong>连接成功！</strong> 耗时 ${res.latency_ms}ms · 模型 <code>${escHtml(res.model_name)}</code><br/>回复预览：${escHtml(res.raw_reply)}`;
    } catch (e) {
      resBox.style.background = '#FEF2F2';
      resBox.style.color = '#991B1B';
      resBox.textContent = '❌ 连接失败：' + e.message;
    } finally {
      btn.disabled = false;
      btn.textContent = '🔌 测试连接';
    }
  }

  async function saveAiConfig() {
    const payload = {
      enabled: document.getElementById('aiCfgEnabled').checked ? 1 : 0,
      provider: document.getElementById('aiCfgProvider').value,
      base_url: document.getElementById('aiCfgBaseUrl').value.trim(),
      model_name: document.getElementById('aiCfgModel').value.trim(),
      api_key: document.getElementById('aiCfgApiKey').value.trim(),
      auto_fallback: document.getElementById('aiCfgFallback').checked ? 1 : 0,
    };
    try {
      const saved = await api('/api/ai/settings', { method: 'POST', body: payload });
      state.aiSettings = saved;
      updateHeaderAiBadge();
      closeAiModal();
      showToast(saved.has_key && saved.enabled ? `已启用真实多模态AI (${saved.model_name})` : 'AI 配置已保存');
    } catch (e) {
      showToast(e.message);
    }
  }

  function toggleApiKeyVisibility() {
    const inp = document.getElementById('aiCfgApiKey');
    if (!inp) return;
    inp.type = inp.type === 'password' ? 'text' : 'password';
  }

  async function clearSavedApiKey() {
    try {
      const saved = await api('/api/ai/settings', { method: 'POST', body: { clear_key: true } });
      state.aiSettings = saved;
      document.getElementById('aiCfgApiKey').value = '';
      document.getElementById('aiSavedKeyHint').textContent = '密钥已清空';
      updateHeaderAiBadge();
      showToast('已清空保存的 API Key');
    } catch (e) {
      showToast(e.message);
    }
  }

  async function saveFullProfile() {
    const body = {
      nickname: document.getElementById('profNickname').value.trim() || '减脂进阶者',
      gender: document.getElementById('profGender').value,
      height_cm: Number(document.getElementById('profHeight').value || 186),
      weight_kg: Number(document.getElementById('profWeight').value || 80),
      age: Number(document.getElementById('profAge').value || 20),
      waist_cm: document.getElementById('profWaist').value || null,
      activity_level: document.getElementById('profActivity').value,
      activity_multiplier: Number(document.getElementById('profMultiplier').value || 1.375),
      weekly_workouts: Number(document.getElementById('profWorkouts').value || 4),
      workout_type: document.getElementById('profWorkoutType').value,
      current_bf: Number(document.getElementById('profCurrentBf').value || 18),
      target_bf: Number(document.getElementById('profTargetBf').value || 13),
      calorie_deficit: Number(document.getElementById('profDeficit').value || 500),
      photos_base64: state.photosBase64,
      onboarding_completed: 1,
    };
    try {
      const res = await api('/api/profile', { method: 'POST', body });
      state.profile = res.profile;
      state.plan = res.plan;
      state.analytics = res.analytics;
      document.getElementById('onboardingBanner').style.display = 'none';
      hydratePlanControls();
      renderAll();
      showToast('身体档案已持久化保存！专属碳循环计划已更新');
      switchTab('plan');
    } catch (e) {
      showToast(e.message);
    }
  }

  // ==================== 方案一：应用内免重装热更新（Service Worker + version.json） ====================
  function compareVersions(a, b) {
    const pa = String(a || '').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
    const pb = String(b || '').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const diff = (pa[i] || 0) - (pb[i] || 0);
      if (diff !== 0) return diff > 0 ? 1 : -1;
    }
    return 0;
  }

  function showUpdateBanner(remoteInfo) {
    const banner = document.getElementById('appUpdateBanner');
    if (!banner) return;
    const verTxt = remoteInfo && remoteInfo.version ? `v${String(remoteInfo.version).replace(/^v/i, '')}` : '最新版本';
    const titleEl = document.getElementById('appUpdateTitle');
    const descEl = document.getElementById('appUpdateDesc');
    if (titleEl) titleEl.textContent = `🚀 发现新版本 ${verTxt}，支持应用内直接更新`;
    if (descEl && remoteInfo && remoteInfo.notes) {
      descEl.textContent = `${remoteInfo.notes}（点击右侧立即刷新生效，数据完整保留）`;
    }
    banner.style.display = 'block';
  }

  function dismissUpdateBanner() {
    const banner = document.getElementById('appUpdateBanner');
    if (banner) banner.style.display = 'none';
  }

  async function checkAppUpdate(manual = false) {
    const btn = document.getElementById('btnCheckUpdate');
    if (manual && btn) {
      btn.disabled = true;
      btn.textContent = '🔄 正在检查更新...';
    }
    try {
      if (!window.location.protocol.startsWith('http')) {
        if (manual) showToast(`当前为纯离线本地包 (v${APP_VERSION})，托管至 HTTPS 后即可支持应用内热更新`);
        return;
      }
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) await reg.update().catch(() => {});
      }
      const resp = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!resp.ok) {
        if (manual) showToast(`当前已是最新版本 v${APP_VERSION}`);
        return;
      }
      const info = await resp.json();
      if (info && info.version && compareVersions(info.version, APP_VERSION) > 0) {
        showUpdateBanner(info);
        if (manual) showToast(`发现新版本 v${info.version}，请点击顶部「立即更新」`);
      } else if (manual) {
        showToast(`✅ 当前已是最新版本 v${APP_VERSION}`);
      }
    } catch (_) {
      if (manual) showToast(`当前处于离线状态 (v${APP_VERSION})，联网后可自动检测更新`);
    } finally {
      if (manual && btn) {
        btn.disabled = false;
        btn.textContent = '🔄 检查应用内更新';
      }
    }
  }

  async function applyInAppUpdate() {
    showToast('🚀 正在应用内热更新至最新版...');
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          await reg.update().catch(() => {});
        }
      }
    } catch (_) {}
    const url = new URL(window.location.href);
    url.searchParams.set('_r', String(Date.now()));
    window.location.replace(url.toString());
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    switchTab,
    setScheduleMode,
    onAutoCountInput,
    applyAutoSchedule,
    cycleSingleDay,
    applyQuickTemplate,
    setMacroStrategy,
    saveMacroAndOffsetSettings,
    saveMetabolicOverrides,
    resetCustomMetabolism,
    fillMealSample,
    runTextFoodAI,
    triggerPhotoUpload,
    onMealPhotoSelected,
    reAnalyzeLastMealPhoto,
    updatePendingGrams,
    commitAiFoodItems,
    setFoodCategory,
    searchFoodLibrary,
    openAddFoodModal,
    closeAddFoodModal,
    setModalGrams,
    stepModalGrams,
    updateAddFoodCalc,
    confirmAddDbFood,
    loadDietForDate,
    removeFoodLog,
    quickLogRecommended,
    selectBodyState,
    loadCheckinForDate,
    submitCheckin,
    editHistoryCheckin,
    removeCheckin,
    setChartRange,
    seedDemoData,
    clearDemoData,
    onActivityLevelChange,
    fillBaselineDemoProfile,
    onBodyPhotoChange,
    removeBodyPhoto,
    onSlotDragOver,
    onSlotDragLeave,
    onSlotDrop,
    generateMockBodyPhotos,
    runBodyFatAI,
    saveFullProfile,
    openAiModal,
    closeAiModal,
    onAiProviderChange,
    selectQuickModel,
    testAiConnection,
    saveAiConfig,
    toggleApiKeyVisibility,
    clearSavedApiKey,
    openOnboardingWizard,
    goOnboardStep,
    selectOnboardGender,
    selectOnboardActivity,
    selectOnboardRhythm,
    autoEstimateOnboardBf,
    updateOnboardLiveCalc,
    skipOnboarding,
    finishOnboarding,
    checkAppUpdate,
    applyInAppUpdate,
    dismissUpdateBanner,
  };
})();
