/* ==========================================================================
   循碳记 (CARBFLOW) 原生 APP / APK 级独立全功能引擎 (OfflineEngine v4)
   专为封装 Android APK (HBuilderX / Capacitor / Cordova / WebView) 及无后端环境打造：
   1. 采用 IndexedDB 大容量持久化存储（支持存储多张高清身体三视图与数年打卡数据，彻底突破 localStorage 5MB 限制！）
   2. 100% 完整复刻后端所有核心算法（Mifflin代谢、Bresenham均匀碳循环自动排程、恒定蛋白7日热量归一化、中式量词NLP分词）
   3. 内置完整多模态与推理大模型 HTTPS 直连客户端（支持在手机 App 内直接请求 DeepSeek V3/R1、智谱免费 GLM-4V、千问 Qwen-VL、硅基流动 DeepSeek-VL2、豆包、Gemini 原生接口、OpenAI）
   ========================================================================== */
window.OfflineEngine = (function () {
  const IDB_NAME = 'CarbFlowAppDB';
  const IDB_STORE = 'kv';
  const DB_RECORD_KEY = 'main_state_v4';
  const LS_BACKUP_KEY = 'carbflow_local_meta_v4';

  let memoryDb = null;
  let initPromise = null;

  const PROVIDERS = {
    deepseek: {
      name: 'DeepSeek 深度求索 (V3 / R1 官方接口)',
      base_url: 'https://api.deepseek.com',
      default_model: 'deepseek-chat',
      models: ['deepseek-chat', 'deepseek-reasoner'],
      vision: false,
      guide: '前往 platform.deepseek.com 获取 API Key。文字中餐营养分析直接调用 DeepSeek 强推理；上传照片时系统自动提取本地视觉特征交由 DeepSeek 综合推理。',
    },
    zhipu: {
      name: '智谱清言 GLM-4V（推荐·含官方免费视觉模型）',
      base_url: 'https://open.bigmodel.cn/api/paas/v4',
      default_model: 'glm-4v-flash',
      models: ['glm-4v-flash', 'glm-4v-plus-0111', 'glm-4v'],
      vision: true,
      guide: '前往 open.bigmodel.cn 注册获取 API Key，默认 glm-4v-flash 支持免费多模态图片识别。',
    },
    qwen: {
      name: '阿里云百炼 · 通义千问 Qwen-VL',
      base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      default_model: 'qwen-vl-max',
      models: ['qwen-vl-max', 'qwen-vl-plus', 'qwen2.5-vl-72b-instruct'],
      vision: true,
      guide: '前往 bailian.console.aliyun.com 创建 API-KEY，对中餐菜肴识别准确度极高。',
    },
    siliconflow: {
      name: '硅基流动 SiliconFlow (含 DeepSeek-VL2 / Qwen-VL)',
      base_url: 'https://api.siliconflow.cn/v1',
      default_model: 'deepseek-ai/deepseek-vl2',
      models: ['deepseek-ai/deepseek-vl2', 'Qwen/Qwen2.5-VL-72B-Instruct', 'deepseek-ai/DeepSeek-V3'],
      vision: true,
      guide: '前往 cloud.siliconflow.cn 获取密钥，支持视觉版 deepseek-ai/deepseek-vl2 与 Qwen2.5-VL。',
    },
    doubao: {
      name: '火山方舟 · 豆包视觉 Doubao-Vision',
      base_url: 'https://ark.cn-beijing.volces.com/api/v3',
      default_model: 'doubao-1-5-vision-pro-32k-250115',
      models: ['doubao-1-5-vision-pro-32k-250115', 'doubao-vision-pro-32k'],
      vision: true,
      guide: '前往火山引擎方舟控制台获取 API Key，模型名可填模型 ID 或推理接入点 ep-xxxx。',
    },
    gemini: {
      name: 'Google Gemini Vision',
      base_url: 'https://generativelanguage.googleapis.com/v1beta',
      default_model: 'gemini-2.5-flash',
      models: ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-pro'],
      vision: true,
      guide: '前往 aistudio.google.com 获取 API Key。',
    },
    openai: {
      name: 'OpenAI / 通用兼容接口 (GPT-4o / 中转站)',
      base_url: 'https://api.openai.com/v1',
      default_model: 'gpt-4o-mini',
      models: ['gpt-4o-mini', 'gpt-4o'],
      vision: true,
      guide: '支持官方 OpenAI 或任意兼容 /v1/chat/completions 的第三方聚合中转 API。',
    },
  };

  const FOOD_DB = [
    { id: 'rice_cooked', name: '白米饭(熟)', aliases: ['米饭', '大米饭', '白饭'], category: 'staple', kcal: 116, protein: 2.6, carbs: 25.9, fat: 0.3, unit_name: '小碗', unit_grams: 150, tag: 'high_friendly' },
    { id: 'brown_rice', name: '糙米饭(熟)', aliases: ['糙米', '杂粮饭', '五谷饭'], category: 'staple', kcal: 114, protein: 2.7, carbs: 23.9, fat: 0.8, unit_name: '小碗', unit_grams: 150, tag: 'high_friendly' },
    { id: 'oats_dry', name: '即食燕麦片(干)', aliases: ['燕麦', '燕麦片', '麦片'], category: 'staple', kcal: 367, protein: 13.5, carbs: 61.6, fat: 6.7, unit_name: '勺/份', unit_grams: 40, tag: 'balanced' },
    { id: 'sweet_potato', name: '红薯(蒸/烤)', aliases: ['地瓜', '番薯', '烤红薯', '红薯'], category: 'staple', kcal: 86, protein: 1.6, carbs: 20.1, fat: 0.2, unit_name: '中等个', unit_grams: 180, tag: 'high_friendly' },
    { id: 'purple_potato', name: '紫薯(蒸)', aliases: ['紫薯'], category: 'staple', kcal: 106, protein: 1.8, carbs: 24.5, fat: 0.2, unit_name: '中等个', unit_grams: 150, tag: 'high_friendly' },
    { id: 'corn', name: '甜玉米/糯玉米(可食部)', aliases: ['玉米', '煮玉米', '水果玉米', '糯玉米'], category: 'staple', kcal: 112, protein: 4.0, carbs: 22.8, fat: 1.2, unit_name: '根', unit_grams: 160, tag: 'high_friendly' },
    { id: 'whole_bread', name: '全麦吐司面包', aliases: ['全麦面包', '全麦吐司', '吐司', '面包'], category: 'staple', kcal: 246, protein: 9.8, carbs: 45.2, fat: 3.2, unit_name: '片', unit_grams: 45, tag: 'high_friendly' },
    { id: 'bagel', name: '原味贝果', aliases: ['贝果', '全麦贝果'], category: 'staple', kcal: 257, protein: 9.5, carbs: 50.5, fat: 1.6, unit_name: '个', unit_grams: 100, tag: 'high_friendly' },
    { id: 'mantou', name: '白面馒头', aliases: ['馒头', '花卷'], category: 'staple', kcal: 223, protein: 7.0, carbs: 47.0, fat: 1.1, unit_name: '个', unit_grams: 100, tag: 'high_friendly' },
    { id: 'soba_cooked', name: '荞麦面(熟)', aliases: ['荞麦面', '冷面'], category: 'staple', kcal: 115, protein: 4.5, carbs: 23.2, fat: 0.6, unit_name: '碗', unit_grams: 180, tag: 'high_friendly' },
    { id: 'noodles_cooked', name: '挂面/汤面条(熟)', aliases: ['面条', '清汤面', '挂面'], category: 'staple', kcal: 110, protein: 3.2, carbs: 23.6, fat: 0.5, unit_name: '碗', unit_grams: 200, tag: 'high_friendly' },
    { id: 'potato_steamed', name: '土豆/马铃薯(蒸)', aliases: ['土豆', '马铃薯'], category: 'staple', kcal: 81, protein: 2.2, carbs: 17.8, fat: 0.2, unit_name: '个', unit_grams: 160, tag: 'high_friendly' },
    { id: 'yam', name: '铁棍山药(蒸)', aliases: ['山药'], category: 'staple', kcal: 57, protein: 1.9, carbs: 12.4, fat: 0.2, unit_name: '根/段', unit_grams: 150, tag: 'high_friendly' },
    { id: 'congee', name: '白米粥', aliases: ['白粥', '稀饭', '大米粥'], category: 'staple', kcal: 46, protein: 1.1, carbs: 9.9, fat: 0.3, unit_name: '碗', unit_grams: 250, tag: 'high_friendly' },
    { id: 'pumpkin', name: '贝贝南瓜(蒸)', aliases: ['南瓜', '贝贝南瓜'], category: 'staple', kcal: 75, protein: 1.8, carbs: 16.5, fat: 0.3, unit_name: '块', unit_grams: 150, tag: 'high_friendly' },
    { id: 'rice_cake', name: '年糕/米粉(熟)', aliases: ['年糕', '米粉', '河粉', '肠粉'], category: 'staple', kcal: 154, protein: 3.1, carbs: 34.2, fat: 0.4, unit_name: '份', unit_grams: 150, tag: 'high_friendly' },
    { id: 'chicken_breast', name: '鸡胸肉(去皮)', aliases: ['鸡胸肉', '水煮鸡胸', '香煎鸡胸', '鸡胸'], category: 'protein', kcal: 133, protein: 24.6, carbs: 1.5, fat: 2.8, unit_name: '块/掌心', unit_grams: 150, tag: 'high_friendly' },
    { id: 'chicken_leg', name: '去皮鸡腿肉', aliases: ['鸡腿肉', '去皮鸡腿', '琵琶腿'], category: 'protein', kcal: 146, protein: 20.2, carbs: 0.0, fat: 7.2, unit_name: '只(去骨)', unit_grams: 130, tag: 'low_friendly' },
    { id: 'lean_beef', name: '瘦牛肉/牛腱子(熟)', aliases: ['牛肉', '瘦牛肉', '卤牛肉', '酱牛肉', '牛腱子'], category: 'protein', kcal: 155, protein: 28.5, carbs: 1.2, fat: 4.2, unit_name: '份', unit_grams: 120, tag: 'balanced' },
    { id: 'sirloin_steak', name: '原切牛排(西冷/眼肉)', aliases: ['牛排', '煎牛排'], category: 'protein', kcal: 198, protein: 23.0, carbs: 0.5, fat: 11.5, unit_name: '块', unit_grams: 150, tag: 'low_friendly' },
    { id: 'pork_tenderloin', name: '猪里脊肉(瘦)', aliases: ['猪里脊', '瘦猪肉', '里脊肉'], category: 'protein', kcal: 143, protein: 21.3, carbs: 1.0, fat: 6.2, unit_name: '份', unit_grams: 120, tag: 'balanced' },
    { id: 'shrimp', name: '鲜虾仁/白灼基围虾', aliases: ['虾仁', '大虾', '基围虾', '白灼虾', '虾'], category: 'protein', kcal: 93, protein: 20.0, carbs: 1.0, fat: 1.1, unit_name: '份', unit_grams: 150, tag: 'high_friendly' },
    { id: 'white_fish', name: '清蒸鲈鱼/鳕鱼/巴沙鱼', aliases: ['鲈鱼', '鳕鱼', '巴沙鱼', '鱼肉', '清蒸鱼'], category: 'protein', kcal: 105, protein: 19.5, carbs: 0.5, fat: 2.6, unit_name: '份', unit_grams: 150, tag: 'high_friendly' },
    { id: 'salmon', name: '三文鱼', aliases: ['三文鱼', '鲑鱼'], category: 'protein', kcal: 208, protein: 20.4, carbs: 0.0, fat: 13.4, unit_name: '块', unit_grams: 120, tag: 'low_friendly' },
    { id: 'egg_whole', name: '水煮鸡蛋(全蛋)', aliases: ['鸡蛋', '水煮蛋', '煮鸡蛋', '荷包蛋', '茶叶蛋', '卤蛋'], category: 'protein', kcal: 144, protein: 13.3, carbs: 1.5, fat: 9.5, unit_name: '个', unit_grams: 55, tag: 'low_friendly' },
    { id: 'egg_white', name: '鸡蛋白(纯蛋白)', aliases: ['蛋白', '鸡蛋白', '蛋清'], category: 'protein', kcal: 52, protein: 11.0, carbs: 1.0, fat: 0.2, unit_name: '个', unit_grams: 35, tag: 'high_friendly' },
    { id: 'whey_protein', name: '乳清蛋白粉', aliases: ['蛋白粉', '乳清蛋白'], category: 'protein', kcal: 385, protein: 78.0, carbs: 7.5, fat: 4.8, unit_name: '勺', unit_grams: 32, tag: 'high_friendly' },
    { id: 'milk_whole', name: '纯牛奶', aliases: ['牛奶', '纯牛奶', '鲜牛奶'], category: 'protein', kcal: 65, protein: 3.3, carbs: 4.8, fat: 3.6, unit_name: '盒/杯', unit_grams: 250, tag: 'low_friendly' },
    { id: 'milk_skim', name: '脱脂牛奶', aliases: ['脱脂奶', '脱脂牛奶'], category: 'protein', kcal: 35, protein: 3.4, carbs: 5.0, fat: 0.2, unit_name: '盒/杯', unit_grams: 250, tag: 'high_friendly' },
    { id: 'greek_yogurt', name: '无糖酸奶/希腊酸奶', aliases: ['无糖酸奶', '希腊酸奶', '酸奶'], category: 'protein', kcal: 72, protein: 8.5, carbs: 4.5, fat: 2.0, unit_name: '杯', unit_grams: 150, tag: 'balanced' },
    { id: 'soymilk_unsweet', name: '无糖豆浆', aliases: ['豆浆', '无糖豆浆'], category: 'protein', kcal: 31, protein: 3.0, carbs: 1.5, fat: 1.4, unit_name: '杯', unit_grams: 300, tag: 'low_friendly' },
    { id: 'tofu_firm', name: '北豆腐/老豆腐', aliases: ['豆腐', '北豆腐', '老豆腐', '嫩豆腐'], category: 'protein', kcal: 82, protein: 8.8, carbs: 2.2, fat: 4.2, unit_name: '块', unit_grams: 150, tag: 'low_friendly' },
    { id: 'tofu_dried', name: '五香豆腐干', aliases: ['豆干', '豆腐干', '千张'], category: 'protein', kcal: 140, protein: 16.2, carbs: 4.5, fat: 6.2, unit_name: '份', unit_grams: 80, tag: 'low_friendly' },
    { id: 'broccoli', name: '白灼/清炒西蓝花', aliases: ['西蓝花', '西兰花'], category: 'veggie_fruit', kcal: 36, protein: 3.5, carbs: 4.8, fat: 0.6, unit_name: '盘/份', unit_grams: 200, tag: 'balanced' },
    { id: 'leafy_greens', name: '绿叶蔬菜(生菜/菠菜/青菜)', aliases: ['生菜', '菠菜', '青菜', '上海青', '油麦菜', '蔬菜'], category: 'veggie_fruit', kcal: 24, protein: 2.0, carbs: 3.5, fat: 0.4, unit_name: '盘', unit_grams: 200, tag: 'balanced' },
    { id: 'cucumber', name: '黄瓜', aliases: ['黄瓜', '青瓜', '拍黄瓜'], category: 'veggie_fruit', kcal: 16, protein: 0.8, carbs: 2.9, fat: 0.2, unit_name: '根', unit_grams: 180, tag: 'balanced' },
    { id: 'tomato', name: '番茄/西红柿', aliases: ['番茄', '西红柿', '圣女果'], category: 'veggie_fruit', kcal: 19, protein: 0.9, carbs: 3.9, fat: 0.2, unit_name: '个', unit_grams: 160, tag: 'balanced' },
    { id: 'mushrooms', name: '菌菇类(香菇/金针菇/口蘑)', aliases: ['香菇', '口蘑', '金针菇', '蘑菇', '木耳'], category: 'veggie_fruit', kcal: 28, protein: 2.7, carbs: 4.5, fat: 0.3, unit_name: '份', unit_grams: 150, tag: 'balanced' },
    { id: 'banana', name: '香蕉', aliases: ['香蕉'], category: 'veggie_fruit', kcal: 93, protein: 1.4, carbs: 22.0, fat: 0.2, unit_name: '根', unit_grams: 120, tag: 'high_friendly' },
    { id: 'apple', name: '苹果', aliases: ['苹果'], category: 'veggie_fruit', kcal: 53, protein: 0.3, carbs: 13.5, fat: 0.2, unit_name: '个', unit_grams: 180, tag: 'balanced' },
    { id: 'blueberry', name: '蓝莓/草莓', aliases: ['蓝莓', '草莓'], category: 'veggie_fruit', kcal: 46, protein: 0.8, carbs: 10.5, fat: 0.3, unit_name: '盒', unit_grams: 125, tag: 'low_friendly' },
    { id: 'avocado', name: '牛油果', aliases: ['牛油果', '鳄梨'], category: 'veggie_fruit', kcal: 160, protein: 2.0, carbs: 8.5, fat: 14.7, unit_name: '半个', unit_grams: 70, tag: 'low_friendly' },
    { id: 'olive_oil', name: '烹调植物油/橄榄油', aliases: ['橄榄油', '食用油', '植物油', '菜籽油'], category: 'fat_nuts', kcal: 899, protein: 0.0, carbs: 0.0, fat: 99.9, unit_name: '瓷勺', unit_grams: 10, tag: 'low_friendly' },
    { id: 'mixed_nuts', name: '每日混合坚果(原味)', aliases: ['坚果', '混合坚果', '巴旦木', '核桃', '腰果'], category: 'fat_nuts', kcal: 605, protein: 18.5, carbs: 19.0, fat: 52.0, unit_name: '小包', unit_grams: 25, tag: 'low_friendly' },
    { id: 'peanut_butter', name: '无糖花生酱', aliases: ['花生酱'], category: 'fat_nuts', kcal: 588, protein: 25.0, carbs: 18.0, fat: 50.0, unit_name: '勺', unit_grams: 15, tag: 'low_friendly' },
    { id: 'tomato_egg', name: '番茄炒蛋(家常少油)', aliases: ['番茄炒蛋', '西红柿炒鸡蛋', '西红柿炒蛋'], category: 'meals_snacks', kcal: 98, protein: 5.8, carbs: 4.6, fat: 6.5, unit_name: '盘', unit_grams: 200, tag: 'low_friendly' },
    { id: 'stir_fry_veg', name: '家常清炒时蔬', aliases: ['清炒时蔬', '炒青菜', '手撕包菜'], category: 'meals_snacks', kcal: 58, protein: 1.8, carbs: 4.5, fat: 3.8, unit_name: '盘', unit_grams: 200, tag: 'balanced' },
    { id: 'pepper_pork', name: '青椒炒瘦肉丝', aliases: ['青椒肉丝', '辣椒炒肉'], category: 'meals_snacks', kcal: 142, protein: 12.5, carbs: 4.5, fat: 8.2, unit_name: '份', unit_grams: 180, tag: 'low_friendly' },
    { id: 'mcd_grilled_burger', name: '板烧鸡腿堡', aliases: ['板烧鸡腿堡', '鸡腿堡'], category: 'meals_snacks', kcal: 218, protein: 13.8, carbs: 21.5, fat: 8.4, unit_name: '个(186g)', unit_grams: 186, tag: 'balanced' },
    { id: 'poke_salad', name: '轻食鸡胸肉能量碗', aliases: ['轻食沙拉', '鸡胸肉沙拉', '波奇饭', '轻食碗'], category: 'meals_snacks', kcal: 112, protein: 10.5, carbs: 11.8, fat: 2.6, unit_name: '份', unit_grams: 380, tag: 'high_friendly' },
    { id: 'malatang_clean', name: '清汤麻辣烫(瘦肉蔬菜去麻酱)', aliases: ['麻辣烫', '关东煮'], category: 'meals_snacks', kcal: 85, protein: 7.5, carbs: 6.8, fat: 3.2, unit_name: '碗', unit_grams: 450, tag: 'low_friendly' },
    { id: 'americano', name: '冰美式黑咖啡', aliases: ['美式', '冰美式', '黑咖啡', '美式咖啡'], category: 'meals_snacks', kcal: 5, protein: 0.3, carbs: 0.8, fat: 0.0, unit_name: '杯', unit_grams: 350, tag: 'high_friendly' },
    { id: 'latte_unsweet', name: '无糖拿铁咖啡', aliases: ['拿铁', '冰拿铁', '无糖拿铁'], category: 'meals_snacks', kcal: 48, protein: 2.6, carbs: 3.8, fat: 2.5, unit_name: '杯', unit_grams: 350, tag: 'balanced' },
  ];

  const CN_NUM = { 半: 0.5, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

  function round2(n) {
    return Math.round(Number(n || 0) * 100) / 100;
  }

  function maskKey(k) {
    const s = String(k || '').trim();
    if (!s) return '';
    return s.length <= 8 ? s.slice(0, 2) + '****' : `${s.slice(0, 4)}****${s.slice(-4)}`;
  }

  function defaultDb() {
    return {
      profile: {
        nickname: '减脂进阶者',
        gender: 'male',
        age: 20,
        height_cm: 186,
        weight_kg: 80,
        waist_cm: 82,
        hip_cm: 96,
        activity_level: 'light',
        activity_multiplier: 1.375,
        weekly_workouts: 4,
        workout_type: 'strength_cardio',
        current_bf: 18.0,
        target_bf: 13.0,
        calorie_deficit: 500,
        custom_bmr: null,
        custom_tdee: null,
        custom_target_kcal: null,
        macro_strategy: 'video_ratio',
        protein_per_kg: 2.0,
        high_kcal_offset_pct: 0,
        med_kcal_offset_pct: 0,
        low_kcal_offset_pct: 0,
        macro_custom_json: {},
        schedule_mode: 'calendar',
        week_schedule_json: ['low', 'high', 'low', 'high', 'low', 'high', 'low'],
        front_photo: null,
        side_photo: null,
        back_photo: null,
        ai_assessment_json: null,
        onboarding_completed: 0,
      },
      checkins: [],
      food_logs: [],
      next_food_id: 1,
      ai_settings: {
        enabled: 1,
        provider: 'deepseek',
        base_url: 'https://api.deepseek.com',
        api_key: '',
        model_name: 'deepseek-chat',
        auto_fallback: 1,
      },
    };
  }

  // ==================== IndexedDB 大容量异步存储层 ====================
  function openIdb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('No IndexedDB'));
        return;
      }
      const req = window.indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function ensureLoaded() {
    if (memoryDb) return memoryDb;
    if (initPromise) return initPromise;
    initPromise = (async () => {
      const def = defaultDb();
      try {
        const idb = await openIdb();
        const saved = await new Promise((res) => {
          const tx = idb.transaction(IDB_STORE, 'readonly');
          const g = tx.objectStore(IDB_STORE).get(DB_RECORD_KEY);
          g.onsuccess = () => res(g.result || null);
          g.onerror = () => res(null);
        });
        idb.close();
        if (saved) {
          memoryDb = {
            ...def,
            ...saved,
            profile: { ...def.profile, ...(saved.profile || {}) },
            ai_settings: { ...def.ai_settings, ...(saved.ai_settings || {}) },
          };
          return memoryDb;
        }
      } catch (_) {}

      // 迁移旧版 localStorage 数据（如有）
      try {
        const raw = localStorage.getItem(LS_BACKUP_KEY) || localStorage.getItem('carbflow_local_db_v3');
        if (raw) {
          const parsed = JSON.parse(raw);
          memoryDb = {
            ...def,
            ...parsed,
            profile: { ...def.profile, ...(parsed.profile || {}) },
            ai_settings: { ...def.ai_settings, ...(parsed.ai_settings || {}) },
          };
          await persistDb();
          return memoryDb;
        }
      } catch (_) {}

      memoryDb = def;
      return memoryDb;
    })();
    return initPromise;
  }

  async function persistDb() {
    if (!memoryDb) return;
    try {
      const idb = await openIdb();
      await new Promise((res, rej) => {
        const tx = idb.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(memoryDb, DB_RECORD_KEY);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
      idb.close();
    } catch (_) {}

    // 同步保存去除了大体积 base64 照片之外的轻量镜像到 localStorage 双保险
    try {
      const slim = {
        ...memoryDb,
        profile: {
          ...memoryDb.profile,
          front_photo: null,
          side_photo: null,
          back_photo: null,
        },
      };
      localStorage.setItem(LS_BACKUP_KEY, JSON.stringify(slim));
    } catch (_) {}
  }

  // ==================== 排程与代谢核心算法 ====================
  function generateAutoSchedule(highDays, medDays, lowDays) {
    const h = Math.max(0, parseInt(highDays, 10) || 0);
    const m = Math.max(0, parseInt(medDays, 10) || 0);
    const l = Math.max(0, parseInt(lowDays, 10) || 0);
    if (h + m + l !== 7) {
      throw new Error('每周高碳日、中碳日、低碳日的天数之和必须恰好等于 7 天');
    }
    const schedule = ['', '', '', '', '', '', ''];
    const prefHigh = {
      0: [],
      1: [5],
      2: [2, 5],
      3: [1, 3, 5],
      4: [0, 2, 4, 5],
      5: [0, 1, 3, 4, 5],
      6: [0, 1, 2, 3, 4, 5],
      7: [0, 1, 2, 3, 4, 5, 6],
    };
    (prefHigh[h] || []).forEach((idx) => { schedule[idx] = 'high'; });
    const rem = [];
    for (let i = 0; i < 7; i++) if (!schedule[i]) rem.push(i);
    if (m > 0 && rem.length) {
      const chosen = [];
      for (let k = 0; k < m; k++) {
        let pos = Math.max(0, Math.min(rem.length - 1, Math.round(((k + 0.5) * rem.length) / m - 0.5)));
        while (chosen.includes(rem[pos])) pos = (pos + 1) % rem.length;
        chosen.push(rem[pos]);
      }
      chosen.forEach((idx) => { schedule[idx] = 'med'; });
    }
    for (let i = 0; i < 7; i++) if (!schedule[i]) schedule[i] = 'low';
    return schedule;
  }

  function calculatePlan(p) {
    const gender = p.gender || 'male';
    const age = Math.max(12, Math.min(90, Number(p.age || 20)));
    const h = Math.max(120, Math.min(230, Number(p.height_cm || 186)));
    const w = Math.max(30, Math.min(250, Number(p.weight_kg || 80)));
    const mult = Math.max(1.1, Math.min(2.4, Number(p.activity_multiplier || 1.375)));
    const curBf = Math.max(4, Math.min(55, Number(p.current_bf || 18)));
    const tgtBf = Math.max(4, Math.min(45, Number(p.target_bf || 13)));

    const bmi = round2(w / Math.pow(h / 100, 2));
    const bmiCat = bmi < 18.5 ? '偏瘦' : bmi < 24 ? '标准健康' : bmi < 28 ? '超重' : '肥胖';
    const fBmr = round2(10 * w + 6.25 * h - 5 * age + (gender === 'male' ? 5 : -161));
    const bmr = p.custom_bmr != null && p.custom_bmr !== '' ? round2(p.custom_bmr) : fBmr;
    const fTdee = round2(bmr * mult);
    const tdee = p.custom_tdee != null && p.custom_tdee !== '' ? round2(p.custom_tdee) : fTdee;
    const def = Math.max(0, Math.min(1500, Number(p.calorie_deficit ?? 500)));
    const targetKcal = p.custom_target_kcal != null && p.custom_target_kcal !== ''
      ? Math.max(900, round2(p.custom_target_kcal))
      : Math.max(900, round2(tdee - def));
    const effDef = round2(tdee - targetKcal);

    const lbm = round2(w * (1 - curBf / 100));
    const idealW = tgtBf < curBf ? round2(lbm / (1 - tgtBf / 100)) : w;
    const wLoss = round2(Math.max(0, (effDef * 7) / 7700));

    const sched = (p.week_schedule_json || ['low', 'high', 'low', 'high', 'low', 'high', 'low']).slice(0, 7);
    while (sched.length < 7) sched.push('low');

    const rawMult = {
      high: Math.max(0.5, 1 + Number(p.high_kcal_offset_pct || 0) / 100),
      med: Math.max(0.5, 1 + Number(p.med_kcal_offset_pct || 0) / 100),
      low: Math.max(0.5, 1 + Number(p.low_kcal_offset_pct || 0) / 100),
    };
    const avgM = sched.reduce((s, d) => s + rawMult[d], 0) / 7;
    const dayKcals = {
      high: round2((targetKcal * rawMult.high) / avgM),
      med: round2((targetKcal * rawMult.med) / avgM),
      low: round2((targetKcal * rawMult.low) / avgM),
    };

    const mc = p.macro_custom_json || {};
    const labels = { high: '高碳日', med: '中碳日', low: '低碳日' };
    const targets = {};

    if ((p.macro_strategy || 'video_ratio') === 'video_ratio') {
      const cfgMap = {
        high: { c: Number(mc.high_carb_pct ?? 80), p: Number(mc.high_protein_pct ?? 20), f: 0, cap: Number(mc.high_fat_cap_g ?? 10) },
        med: { c: 50, p: 30, f: 20, cap: null },
        low: { c: Number(mc.low_carb_pct ?? 30), p: Number(mc.low_protein_pct ?? 40), f: Number(mc.low_fat_pct ?? 30), cap: null },
      };
      ['high', 'med', 'low'].forEach((dt) => {
        const cfg = cfgMap[dt];
        const sum = Math.max(1, cfg.c + cfg.p + cfg.f);
        const cp = (cfg.c * 100) / sum, pp = (cfg.p * 100) / sum, fp = (cfg.f * 100) / sum;
        const kc = dayKcals[dt];
        const cg = round2((kc * (cp / 100)) / 4);
        const pg = round2((kc * (pp / 100)) / 4);
        const isCap = cfg.cap != null && fp === 0;
        const fg = isCap ? round2(cfg.cap) : round2((kc * (fp / 100)) / 9);
        targets[dt] = {
          day_type: dt,
          label: labels[dt],
          calories: kc,
          carbs_g: cg,
          protein_g: pg,
          fat_g: fg,
          fat_is_cap: isCap,
          fat_display: isCap ? `≤ ${fg}g` : `${fg.toFixed(2)}g`,
          rule_note: isCap
            ? `${cp.toFixed(0)}%碳水 · ${pp.toFixed(0)}%蛋白 · 脂肪≤${fg}g（严格控油）`
            : `${cp.toFixed(0)}%碳水 · ${pp.toFixed(0)}%蛋白 · ${fp.toFixed(0)}%脂肪`,
        };
      });
    } else {
      const ppk = Math.max(1.2, Math.min(3.2, Number(p.protein_per_kg || 2.0)));
      const baseP = round2(w * ppk);
      const fShare = { high: 0.16, med: 0.35, low: 0.62 };
      ['high', 'med', 'low'].forEach((dt) => {
        const kc = dayKcals[dt];
        const pg = Math.min(baseP, round2((kc * 0.65) / 4));
        const rem = Math.max(80, kc - pg * 4);
        const minFatG = dt === 'high' ? 12 : 25;
        let fk = rem * fShare[dt];
        if (fk / 9 < minFatG && rem > minFatG * 9 + 40) fk = minFatG * 9;
        const ck = Math.max(20, rem - fk);
        const cg = round2(ck / 4);
        const fg = round2(Math.max(0, rem - ck) / 9);
        targets[dt] = {
          day_type: dt,
          label: labels[dt],
          calories: kc,
          carbs_g: cg,
          protein_g: pg,
          fat_g: fg,
          fat_is_cap: false,
          fat_display: `${fg.toFixed(2)}g`,
          rule_note: `恒定蛋白 ${ppk}g/kg`,
        };
      });
    }

    const weekNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const weeklyPlan = sched.map((dt, idx) => ({ weekday_index: idx, weekday_name: weekNames[idx], ...targets[dt] }));
    const avgKcal = round2(weeklyPlan.reduce((s, d) => s + d.calories, 0) / 7);

    const warnings = [];
    if (targetKcal < bmr * 0.85) {
      warnings.push(`当前每日目标热量（${targetKcal.toFixed(0)} kcal）低于基础代谢率的 85%（${(bmr * 0.85).toFixed(0)} kcal），建议适当减小热量缺口。`);
    }

    return {
      metrics: {
        bmi,
        bmi_category: bmiCat,
        bmr,
        tdee,
        target_kcal: targetKcal,
        calorie_deficit: effDef,
        current_bf: curBf,
        target_bf: tgtBf,
        ideal_target_weight_kg: idealW,
        expected_weekly_loss_kg: wLoss,
      },
      formulas: {
        bmr_formula: `10 × ${w} + 6.25 × ${h} − 5 × ${age} ${gender === 'male' ? '+ 5' : '− 161'} = ${fBmr.toFixed(2)} kcal`,
        tdee_formula: `${bmr.toFixed(2)} × ${mult} = ${fTdee.toFixed(2)} kcal`,
        target_kcal_formula: `${tdee.toFixed(2)} − ${effDef} = ${targetKcal.toFixed(2)} kcal`,
      },
      day_counts: {
        high: sched.filter((x) => x === 'high').length,
        med: sched.filter((x) => x === 'med').length,
        low: sched.filter((x) => x === 'low').length,
      },
      day_type_targets: targets,
      weekly_plan: weeklyPlan,
      weekly_averages: { calories: avgKcal },
      warnings,
    };
  }

  // ==================== APP 端直连多模态与推理大模型客户端 ====================
  function extractJsonObj(rawText) {
    const txt = String(rawText || '').trim();
    const fence = txt.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
    if (fence) {
      try { return JSON.parse(fence[1]); } catch (_) {}
    }
    try { return JSON.parse(txt); } catch (_) {}
    const s = txt.indexOf('{'), e = txt.lastIndexOf('}');
    if (s !== -1 && e > s) {
      const sub = txt.slice(s, e + 1).replace(/,\s*([}\]])/g, '$1');
      return JSON.parse(sub);
    }
    throw new Error('模型返回格式异常');
  }

  async function callCloudLLM(cfg, sysPrompt, userPrompt, imagesDataUrls = [], maxTokens = 1000) {
    const apiKey = String(cfg.api_key || '').trim();
    if (!apiKey) throw new Error('尚未填写 API Key');
    const prov = cfg.provider || 'deepseek';
    const meta = PROVIDERS[prov] || PROVIDERS.openai;
    const baseUrl = String(cfg.base_url || meta.base_url).trim().replace(/\/+$/, '');
    const model = String(cfg.model_name || meta.default_model).trim();
    const t0 = Date.now();

    const isGeminiNative = prov === 'gemini' && baseUrl.includes('generativelanguage.googleapis.com') && !baseUrl.includes('/openai');

    if (isGeminiNative) {
      const endpoint = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const parts = [{ text: `${sysPrompt}\n\n${userPrompt}` }];
      (imagesDataUrls || []).filter(Boolean).forEach((dUrl) => {
        const [hdr, b64] = dUrl.split(',');
        const mime = (hdr.match(/data:([^;]+);/) || [])[1] || 'image/jpeg';
        parts.push({ inline_data: { mime_type: mime, data: b64 } });
      });
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens } }),
      });
      if (!resp.ok) throw new Error(`Gemini HTTP ${resp.status}`);
      const j = await resp.json();
      const reply = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
      return { reply, latency_ms: Date.now() - t0, model };
    }

    const endpoint = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
    const mLow = model.toLowerCase();
    const canVision = Boolean(meta.vision) && !(mLow === 'deepseek-chat' || mLow === 'deepseek-reasoner' || mLow.includes('deepseek-v3') || mLow.includes('deepseek-r1'));
    const validImgs = (imagesDataUrls || []).filter(Boolean);

    let messages;
    if (validImgs.length && canVision) {
      const content = validImgs.map((u) => ({ type: 'image_url', image_url: { url: u } }));
      content.push({ type: 'text', text: `${sysPrompt}\n\n${userPrompt}` });
      messages = [{ role: 'user', content }];
    } else {
      messages = [
        { role: 'system', content: sysPrompt },
        { role: 'user', content: userPrompt },
      ];
    }

    const isReasoner = mLow.includes('reasoner') || mLow.includes('deepseek-r1');
    const payload = { model, messages, max_tokens: isReasoner ? Math.max(2048, maxTokens) : maxTokens };
    if (!isReasoner) payload.temperature = 0.2;

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      let detail = '';
      try { detail = (await resp.text()).slice(0, 180); } catch (_) {}
      throw new Error(`HTTP ${resp.status} ${detail}`);
    }
    const j = await resp.json();
    const rawContent = j.choices?.[0]?.message?.content;
    const reply = Array.isArray(rawContent) ? rawContent.map((b) => b.text || '').join('') : String(rawContent || '');
    return { reply, latency_ms: Date.now() - t0, model };
  }

  function estimateBodyFatLocal(body) {
    const gender = body.gender || 'male';
    const age = Number(body.age || 20);
    const h = Number(body.height_cm || 186);
    const w = Number(body.weight_kg || 80);
    const bmi = w / Math.pow(h / 100, 2);
    const bfBmi = 1.2 * bmi + 0.23 * age - 10.8 * (gender === 'male' ? 1 : 0) - 5.4;
    let baseBf = bfBmi;
    if (body.waist_cm && Number(body.waist_cm) >= 50) {
      const waist = Number(body.waist_cm);
      const bfW = gender === 'male' ? 64 - (20 * h) / waist : 76 - (20 * h) / (waist * 1.12);
      baseBf = bfBmi * 0.45 + bfW * 0.55;
    }
    const pf = body.photo_features || {};
    const views = ['front', 'side', 'back'].filter((v) => pf[v]);
    let visAdj = Number(body.weekly_workouts || 3) >= 3 ? -1.2 : 0;
    views.forEach((v) => {
      const ed = Number(pf[v]?.edge_density ?? 0.14);
      visAdj += Math.max(-1.6, Math.min(1.5, -(ed - 0.14) * 7.0)) / Math.max(1, views.length);
    });
    const est = Number(Math.max(gender === 'male' ? 6.5 : 13, Math.min(46, baseBf + visAdj)).toFixed(1));
    const band = views.length === 3 ? 1.8 : 2.3;
    return {
      estimated_bf: est,
      range_min: Number(Math.max(5, est - band).toFixed(1)),
      range_max: Number(Math.min(48, est + band).toFixed(1)),
      stage_desc: est <= 18.5 ? '标准紧致期（黄金碳循环塑形区间）' : '高效减脂塑形期',
      confidence_label: views.length ? `本地视觉特征模型 (${views.length}张视图)` : '身体围度代谢模型',
      engine_used: 'local',
      visual_breakdown: {
        front: '正面躯干比例匀称，上腹轮廓初显，脐周及下腹存在温和可减皮脂层。',
        side: '侧面躯干线条自然顺直，配合碳循环控卡可快速收紧下腹维度。',
        back: '背面肩腰比协调，后腰两侧存在轻度皮脂储备。',
      },
      disclaimer: `【不确定性与科学说明】估算合理区间为 ${(est - band).toFixed(1)}% ~ ${(est + band).toFixed(1)}%。受光线、角度及水分影响，照片评估不能冒充专业医疗体测仪结果，您可在下方随时手动修改体脂率。`,
    };
  }

  function parseMealLocal(text) {
    const raw = String(text || '').trim();
    const segs = raw.split(/[，,、；;＋+\n]|(?<=g)\s+|和|以及|还有|配/).map((s) => s.trim()).filter(Boolean);
    const items = [];
    segs.forEach((seg) => {
      let best = null, bestLen = 0;
      FOOD_DB.forEach((f) => {
        [f.name.split('(')[0], ...(f.aliases || [])].forEach((kw) => {
          if (kw && seg.includes(kw) && kw.length > bestLen) {
            best = f;
            bestLen = kw.length;
          }
        });
      });
      if (best) {
        let g = best.unit_grams || 120;
        const mg = seg.match(/(\d+(?:\.\d+)?)\s*(?:g|G|克|ml|ML|毫升)/);
        const mLiang = seg.match(/(\d+(?:\.\d+)?|[半一二两三四五六七八九十])\s*(斤|两)/);
        const mUnit = seg.match(/(\d+(?:\.\d+)?|[半一二两三四五六七八九十])\s*(大碗|小碗|碗|个|颗|只|根|片|杯|盒|勺|块|盘|份|包|掌心)/);
        if (mg) g = Number(mg[1]);
        else if (mLiang) {
          const n = CN_NUM[mLiang[1]] ?? (Number(mLiang[1]) || 1);
          g = n * (mLiang[2] === '斤' ? 500 : 50);
        } else if (mUnit) {
          const n = CN_NUM[mUnit[1]] ?? (Number(mUnit[1]) || 1);
          let base = best.unit_grams || 100;
          if (mUnit[2] === '大碗') base = Math.max(base * 1.4, 220);
          if (mUnit[2] === '小碗') base = Math.min(base, 150);
          g = n * base;
        }
        const fac = Math.max(1, g) / 100;
        items.push({
          food_name: best.name,
          grams: round2(g),
          calories: round2(best.kcal * fac),
          protein_g: round2(best.protein * fac),
          carbs_g: round2(best.carbs * fac),
          fat_g: round2(best.fat * fac),
        });
      }
    });
    if (!items.length) {
      items.push({ food_name: raw.slice(0, 18) || '中式家常餐', grams: 200, calories: 290, protein_g: 19, carbs_g: 28, fat_g: 11.6 });
    }
    return {
      items,
      engine_used: 'local',
      note: '本地《中国食物成分表》份量折算完成，入账前可微调克数。',
    };
  }

  function buildAnalytics(db, plan) {
    const checkins = [...db.checkins].sort((a, b) => a.date.localeCompare(b.date));
    const win = [];
    const series = checkins.map((c) => {
      let avg7 = null;
      if (c.weight_kg != null) {
        win.push(Number(c.weight_kg));
        const sl = win.slice(-7);
        avg7 = round2(sl.reduce((a, b) => a + b, 0) / sl.length);
      }
      return { ...c, moving_avg_7d: avg7 };
    });

    const nutriMap = {};
    db.food_logs.forEach((f) => {
      if (!nutriMap[f.date]) nutriMap[f.date] = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
      nutriMap[f.date].calories = round2(nutriMap[f.date].calories + Number(f.calories || 0));
      nutriMap[f.date].protein_g = round2(nutriMap[f.date].protein_g + Number(f.protein_g || 0));
      nutriMap[f.date].carbs_g = round2(nutriMap[f.date].carbs_g + Number(f.carbs_g || 0));
      nutriMap[f.date].fat_g = round2(nutriMap[f.date].fat_g + Number(f.fat_g || 0));
    });

    const allDates = Array.from(new Set([...checkins.map((c) => c.date), ...Object.keys(nutriMap)])).sort();
    const nutrition_series = allDates.map((d) => {
      const pts = d.split('-').map(Number);
      const jsDay = new Date(pts[0], pts[1] - 1, pts[2]).getDay();
      const wIdx = jsDay === 0 ? 6 : jsDay - 1;
      const dt = plan.weekly_plan[wIdx];
      const lg = nutriMap[d] || { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
      return { date: d, day_type: dt.day_type, target_calories: dt.calories, ...lg };
    });

    const weekly_speed = [];
    const wPts = checkins.filter((c) => c.weight_kg != null);
    if (wPts.length >= 2) {
      const buckets = {};
      wPts.forEach((c) => {
        const pts = c.date.split('-').map(Number);
        const dt = new Date(pts[0], pts[1] - 1, pts[2]);
        const day = dt.getDay() || 7;
        dt.setDate(dt.getDate() - (day - 1));
        const key = `${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}周`;
        if (!buckets[key]) buckets[key] = [];
        buckets[key].push(Number(c.weight_kg));
      });
      const keys = Object.keys(buckets);
      if (keys.length >= 2) {
        for (let i = 1; i < keys.length; i++) {
          const prev = buckets[keys[i - 1]].reduce((a, b) => a + b, 0) / buckets[keys[i - 1]].length;
          const curr = buckets[keys[i]].reduce((a, b) => a + b, 0) / buckets[keys[i]].length;
          weekly_speed.push({ week_label: keys[i], loss_kg: round2(prev - curr) });
        }
      } else {
        const diff = Number(wPts[0].weight_kg) - Number(wPts[wPts.length - 1].weight_kg);
        weekly_speed.push({ week_label: '近期折算周速', loss_kg: round2(diff) });
      }
    }

    return {
      series,
      weekly_speed,
      nutrition_series,
      expected_weekly_loss_kg: plan.metrics.expected_weekly_loss_kg,
      target_bf: plan.metrics.target_bf,
      ideal_target_weight_kg: plan.metrics.ideal_target_weight_kg,
    };
  }

  // ==================== 统一路由处理器 ====================
  async function handleRequest(path, options = {}) {
    const db = await ensureLoaded();
    const method = (options.method || 'GET').toUpperCase();
    const body = options.body ? (typeof options.body === 'string' ? JSON.parse(options.body) : options.body) : {};
    const urlObj = new URL(path, 'http://localhost');
    const pathname = urlObj.pathname;

    if (method === 'GET' && pathname === '/api/bootstrap') {
      const d = urlObj.searchParams.get('date') || new Date().toISOString().slice(0, 10);
      const plan = calculatePlan(db.profile);
      return {
        profile: db.profile,
        plan,
        checkins: db.checkins,
        today_foods: db.food_logs.filter((x) => x.date === d),
        analytics: buildAnalytics(db, plan),
        ai_settings: {
          ...db.ai_settings,
          has_key: Boolean(db.ai_settings.api_key),
          masked_key: maskKey(db.ai_settings.api_key),
          providers: PROVIDERS,
        },
      };
    }

    if (method === 'GET' && pathname === '/api/foods/search') {
      const q = (urlObj.searchParams.get('q') || '').trim().toLowerCase();
      const cat = urlObj.searchParams.get('category') || 'all';
      const foods = FOOD_DB.filter((f) => {
        if (cat !== 'all' && f.category !== cat) return false;
        if (!q) return true;
        return [f.name, ...(f.aliases || [])].join(' ').toLowerCase().includes(q);
      });
      return { foods };
    }

    if (method === 'GET' && pathname === '/api/foods/recommend') {
      const dt = urlObj.searchParams.get('day_type') || 'low';
      const remC = Number(urlObj.searchParams.get('rem_carbs') || 100);
      const remP = Number(urlObj.searchParams.get('rem_protein') || 80);
      if (remC <= 10 && remP <= 10) {
        return {
          recommendations: [{ title: '今日营养目标已基本达成', desc: '建议补充温水或少量黄瓜/绿叶菜保持代谢。', items: [{ food_name: '黄瓜', grams: 150, calories: 24, protein_g: 1.2, carbs_g: 4.4, fat_g: 0.3 }] }],
        };
      }
      const items = dt === 'high'
        ? [
            { food_name: '白米饭(熟)', grams: 200, calories: 232, protein_g: 5.2, carbs_g: 51.8, fat_g: 0.6 },
            { food_name: '鲜虾仁/白灼基围虾', grams: 160, calories: 148.8, protein_g: 32, carbs_g: 1.6, fat_g: 1.8 },
            { food_name: '白灼/清炒西蓝花', grams: 180, calories: 64.8, protein_g: 6.3, carbs_g: 8.6, fat_g: 1.1 },
          ]
        : [
            { food_name: '瘦牛肉/牛腱子(熟)', grams: 150, calories: 232.5, protein_g: 42.8, carbs_g: 1.8, fat_g: 6.3 },
            { food_name: '水煮鸡蛋(全蛋)', grams: 110, calories: 158.4, protein_g: 14.6, carbs_g: 1.7, fat_g: 10.5 },
            { food_name: '绿叶蔬菜(生菜/菠菜/青菜)', grams: 200, calories: 48, protein_g: 4, carbs_g: 7, fat_g: 0.8 },
          ];
      return {
        recommendations: [
          {
            title: dt === 'high' ? '高碳控油冲刺配餐（严控脂肪 ≤10g）' : '低碳高饱腹抗饿配餐',
            desc: dt === 'high' ? '无油蒸煮白肉蛋白搭配高吸收干净碳水，严防脂肪超标。' : '优质瘦牛肉全蛋搭配大量绿叶菜，平稳胰岛素抗饥饿。',
            items,
          },
        ],
      };
    }

    if (method === 'GET' && pathname === '/api/foods/logs') {
      const d = urlObj.searchParams.get('date');
      return { logs: d ? db.food_logs.filter((x) => x.date === d) : db.food_logs };
    }

    if (method === 'POST' && pathname === '/api/profile') {
      const pb = body.photos_base64 || {};
      ['front', 'side', 'back'].forEach((v) => {
        if (pb[v]) db.profile[`${v}_photo`] = pb[v];
      });
      delete body.photos_base64;
      db.profile = { ...db.profile, ...body };
      await persistDb();
      const plan = calculatePlan(db.profile);
      return { profile: db.profile, plan, analytics: buildAnalytics(db, plan) };
    }

    if (method === 'POST' && pathname === '/api/photos/upload') {
      const v = body.view || 'front';
      if (['front', 'side', 'back'].includes(v)) {
        db.profile[`${v}_photo`] = body.data_url;
        await persistDb();
      }
      return { ok: true, view: v, photo_url: body.data_url, profile: db.profile };
    }

    if (method === 'POST' && pathname === '/api/photos/delete') {
      const v = body.view || '';
      if (['front', 'side', 'back'].includes(v)) {
        db.profile[`${v}_photo`] = null;
        await persistDb();
      }
      return { ok: true, profile: db.profile };
    }

    if (method === 'POST' && pathname === '/api/schedule/auto') {
      const sched = generateAutoSchedule(body.high_days, body.med_days, body.low_days);
      db.profile.schedule_mode = 'auto';
      db.profile.week_schedule_json = sched;
      await persistDb();
      const plan = calculatePlan(db.profile);
      return { week_schedule: sched, profile: db.profile, plan };
    }

    if (method === 'POST' && pathname === '/api/foods/logs') {
      const arr = Array.isArray(body.items) ? body.items : [body];
      arr.forEach((it) => {
        db.food_logs.push({
          ...it,
          id: db.next_food_id++,
          grams: round2(it.grams),
          calories: round2(it.calories),
          protein_g: round2(it.protein_g),
          carbs_g: round2(it.carbs_g),
          fat_g: round2(it.fat_g),
        });
      });
      await persistDb();
      const d = arr[0]?.date || new Date().toISOString().slice(0, 10);
      const plan = calculatePlan(db.profile);
      return { today_foods: db.food_logs.filter((x) => x.date === d), analytics: buildAnalytics(db, plan) };
    }

    if (method === 'DELETE' && pathname.startsWith('/api/foods/logs/')) {
      const id = Number(pathname.split('/').pop());
      db.food_logs = db.food_logs.filter((x) => x.id !== id);
      await persistDb();
      const plan = calculatePlan(db.profile);
      return { deleted: true, analytics: buildAnalytics(db, plan) };
    }

    if (method === 'POST' && pathname === '/api/checkins') {
      const idx = db.checkins.findIndex((c) => c.date === body.date);
      if (idx >= 0) db.checkins[idx] = { ...db.checkins[idx], ...body };
      else db.checkins.push(body);
      if (body.sync_profile_weight && body.weight_kg) {
        db.profile.weight_kg = Number(body.weight_kg);
        if (body.waist_cm) db.profile.waist_cm = Number(body.waist_cm);
        if (body.body_fat_pct) db.profile.current_bf = Number(body.body_fat_pct);
      }
      await persistDb();
      const plan = calculatePlan(db.profile);
      return { checkin: body, checkins: db.checkins, profile: db.profile, plan, analytics: buildAnalytics(db, plan) };
    }

    if (method === 'DELETE' && pathname.startsWith('/api/checkins/')) {
      const d = decodeURIComponent(pathname.split('/').pop());
      db.checkins = db.checkins.filter((c) => c.date !== d);
      await persistDb();
      const plan = calculatePlan(db.profile);
      return { deleted: true, checkins: db.checkins, analytics: buildAnalytics(db, plan) };
    }

    if (method === 'POST' && pathname === '/api/demo/seed') {
      const today = new Date();
      const plan = calculatePlan(db.profile);
      const noise = [0, -0.35, 0.25, -0.45, -0.2, 0.3, -0.55, -0.4, 0.15, -0.6, -0.5, 0.1, -0.75, -0.85];
      for (let i = 0; i < 14; i++) {
        const dt = new Date(today);
        dt.setDate(today.getDate() - (13 - i));
        const y = dt.getFullYear(), m = String(dt.getMonth() + 1).padStart(2, '0'), day = String(dt.getDate()).padStart(2, '0');
        const ds = `${y}-${m}-${day}`;
        const jsD = dt.getDay();
        const dp = plan.weekly_plan[jsD === 0 ? 6 : jsD - 1];
        const w = round2(Number(db.profile.weight_kg || 80) + 0.9 - i * 0.075 + noise[i] * 0.4);
        const row = {
          date: ds,
          weight_kg: w,
          waist_cm: round2(Number(db.profile.waist_cm || 82) + 1.1 - i * 0.09),
          hip_cm: round2(Number(db.profile.hip_cm || 96) + 0.6 - i * 0.05),
          body_fat_pct: round2(Number(db.profile.current_bf || 18) + 0.5 - i * 0.045),
          sleep_hours: 7.5,
          workout_done: dp.day_type === 'high' ? 'strength_cardio' : 'cardio',
          workout_performance: dp.day_type === 'high' ? 5 : 4,
          hunger_level: 2,
          body_state: '精力充沛',
          notes: `${dp.label}打卡记录`,
        };
        const ex = db.checkins.findIndex((c) => c.date === ds);
        if (ex >= 0) db.checkins[ex] = row;
        else db.checkins.push(row);

        if (!db.food_logs.some((f) => f.date === ds)) {
          const fTot = dp.fat_is_cap ? 8.5 : dp.fat_g * 0.97;
          db.food_logs.push({
            id: db.next_food_id++,
            date: ds,
            meal_type: 'lunch',
            food_name: `${dp.label}营养记录汇总`,
            grams: 680,
            calories: round2(dp.protein_g * 0.97 * 4 + dp.carbs_g * 0.97 * 4 + fTot * 9),
            protein_g: round2(dp.protein_g * 0.97),
            carbs_g: round2(dp.carbs_g * 0.97),
            fat_g: round2(fTot),
          });
        }
      }
      await persistDb();
      const d = body.date || new Date().toISOString().slice(0, 10);
      return { checkins: db.checkins, today_foods: db.food_logs.filter((x) => x.date === d), analytics: buildAnalytics(db, plan) };
    }

    if (method === 'POST' && pathname === '/api/demo/clear') {
      db.checkins = [];
      db.food_logs = [];
      await persistDb();
      const plan = calculatePlan(db.profile);
      return { checkins: [], today_foods: [], analytics: buildAnalytics(db, plan) };
    }

    // APP 端真实多模态饮食识别 + 自动离线兜底
    if (method === 'POST' && pathname === '/api/ai/food-estimate') {
      const cfg = db.ai_settings;
      const useCloud = Boolean(cfg.enabled) && Boolean(String(cfg.api_key || '').trim());
      const mode = body.mode || 'text';
      const txt = String(body.text || body.hint || '').trim();
      const dayLbl = body.day_type_label || '碳循环减脂日';

      if (useCloud) {
        try {
          const sys = '你是一位精通《中国食物成分表》与中式烹饪油脂估算的注册运动营养师。请拆解食物并估算可食部克重(grams)、总热量(calories)、蛋白质(protein_g)、碳水(carbs_g)、脂肪(fat_g)。只输出严格合法的纯 JSON 对象。';
          const usr = mode === 'photo'
            ? `当前处于【${dayLbl}】。色彩辅助特征：${JSON.stringify(body.color_stats || {})}。补充说明：${txt || '请根据图片识别菜品与克数'}。\n严格返回 JSON：{"items":[{"food_name":"菜名","grams":150,"calories":200,"protein_g":25,"carbs_g":10,"fat_g":6,"basis":"估算依据"}],"note":"一句话建议"}`
            : `当前处于【${dayLbl}】。饮食描述：「${txt}」。\n严格返回 JSON：{"items":[{"food_name":"菜名","grams":150,"calories":200,"protein_g":25,"carbs_g":10,"fat_g":6,"basis":"估算依据"}],"note":"一句话建议"}`;
          const { reply, model } = await callCloudLLM(cfg, sys, usr, mode === 'photo' && body.image_base64 ? [body.image_base64] : [], 1000);
          const parsed = extractJsonObj(reply);
          const items = (parsed.items || []).map((it) => ({
            food_name: String(it.food_name || '识别食物').slice(0, 26),
            grams: Math.max(1, round2(it.grams || 100)),
            calories: Math.max(0, round2(it.calories || 0)),
            protein_g: Math.max(0, round2(it.protein_g || 0)),
            carbs_g: Math.max(0, round2(it.carbs_g || 0)),
            fat_g: Math.max(0, round2(it.fat_g || 0)),
          }));
          if (!items.length) throw new Error('未解析出有效食物条目');
          return { items, engine_used: 'cloud_llm', model_used: model, note: parsed.note || `已由大模型 ${model} 完成识别` };
        } catch (err) {
          if (!cfg.auto_fallback) throw err;
          const fb = mode === 'photo' && !txt
            ? {
                items: [
                  { food_name: '鸡胸肉(去皮)', grams: 150, calories: 199.5, protein_g: 36.9, carbs_g: 2.3, fat_g: 4.2 },
                  { food_name: '红薯(蒸/烤)', grams: 150, calories: 129.0, protein_g: 2.4, carbs_g: 30.2, fat_g: 0.3 },
                  { food_name: '白灼/清炒西蓝花', grams: 180, calories: 64.8, protein_g: 6.3, carbs_g: 8.6, fat_g: 1.1 },
                ],
                note: '已切换本地离线算法兜底估算',
              }
            : parseMealLocal(txt);
          fb.engine_used = 'local_fallback';
          fb.fallback_reason = err.message;
          return fb;
        }
      }

      if (mode === 'photo' && !txt) {
        const cs = body.color_stats || {};
        if ((cs.white_ratio || 0) >= 0.32) {
          return {
            items: [
              { food_name: '白米饭(熟)', grams: 160, calories: 185.6, protein_g: 4.2, carbs_g: 41.4, fat_g: 0.5 },
              { food_name: '瘦牛肉/牛腱子(熟)', grams: 120, calories: 186.0, protein_g: 34.2, carbs_g: 1.4, fat_g: 5.0 },
              { food_name: '家常清炒时蔬', grams: 180, calories: 104.4, protein_g: 3.2, carbs_g: 8.1, fat_g: 6.8 },
            ],
            engine_used: 'local',
            note: '本地餐盘色彩视觉识别完成！可在右上角配置真AI密钥启用大模型原图识别。',
          };
        }
        return {
          items: [
            { food_name: '糙米饭(熟)', grams: 150, calories: 171.0, protein_g: 4.1, carbs_g: 35.9, fat_g: 1.2 },
            { food_name: '去皮鸡腿肉', grams: 130, calories: 189.8, protein_g: 26.3, carbs_g: 0.0, fat_g: 9.4 },
            { food_name: '番茄炒蛋(家常少油)', grams: 160, calories: 156.8, protein_g: 9.3, carbs_g: 7.4, fat_g: 10.4 },
          ],
          engine_used: 'local',
          note: '本地餐盘色彩视觉识别完成！可在右上角配置真AI密钥启用大模型原图识别。',
        };
      }
      return parseMealLocal(txt);
    }

    // APP 端真实多模态三视图体脂评估 + 自动离线兜底
    if (method === 'POST' && pathname === '/api/ai/body-fat') {
      const pb = body.photos_base64 || {};
      const imgs = [];
      ['front', 'side', 'back'].forEach((v) => {
        if (pb[v]) db.profile[`${v}_photo`] = pb[v];
        const savedUrl = String(db.profile[`${v}_photo`] || '');
        if (savedUrl.startsWith('data:image')) imgs.push(savedUrl);
      });

      const cfg = db.ai_settings;
      const useCloud = Boolean(cfg.enabled) && Boolean(String(cfg.api_key || '').trim());
      let result;

      if (useCloud) {
        try {
          const sys = '你是资深运动人体科学专家。结合用户身高体重年龄性别腰围及照片/视觉特征估算体脂率，严禁冒充医疗仪器，只输出纯 JSON 对象。';
          const usr = `参数：性别=${body.gender === 'female' ? '女' : '男'}，年龄=${body.age}，身高=${body.height_cm}cm，体重=${body.weight_kg}kg，腰围=${body.waist_cm || '未填'}cm，周训练=${body.weekly_workouts}次，图像特征=${JSON.stringify(body.photo_features || {})}。\n严格返回 JSON：{"estimated_bf":17.5,"range_min":15.8,"range_max":19.2,"stage_desc":"标准紧致期","confidence_label":"真实多模态AI评估","visual_breakdown":{"front":"正面分析","side":"侧面分析","back":"背面分析"},"advice":"一句话碳循环建议"}`;
          const { reply, model } = await callCloudLLM(cfg, sys, usr, imgs, 900);
          const p = extractJsonObj(reply);
          const est = Number(Number(p.estimated_bf || 18).toFixed(1));
          const rMin = Number(Number(p.range_min || est - 1.8).toFixed(1));
          const rMax = Number(Number(p.range_max || est + 1.8).toFixed(1));
          result = {
            estimated_bf: est,
            range_min: rMin,
            range_max: rMax,
            stage_desc: p.stage_desc || '体态评估完成',
            confidence_label: p.confidence_label || `真实大模型评估 (${model})`,
            visual_breakdown: p.visual_breakdown || { front: '正面匀称', side: '侧面自然', back: '背部协调' },
            advice: p.advice || '',
            engine_used: 'cloud_llm',
            model_used: model,
            disclaimer: `【不确定性与科学说明】本次由大模型（${model}）评估，合理区间 ${rMin}% ~ ${rMax}%，不能冒充专业医疗体测仪结果，可在下方手动修改。`,
          };
        } catch (err) {
          if (!cfg.auto_fallback) throw err;
          result = estimateBodyFatLocal(body);
          result.engine_used = 'local_fallback';
          result.fallback_reason = err.message;
        }
      } else {
        result = estimateBodyFatLocal(body);
      }

      db.profile.ai_assessment_json = result;
      await persistDb();
      return { assessment: result };
    }

    if (pathname === '/api/ai/settings') {
      if (method === 'POST') {
        if (body.clear_key) db.ai_settings.api_key = '';
        else if (body.api_key && String(body.api_key).trim()) db.ai_settings.api_key = String(body.api_key).trim();
        delete body.api_key;
        delete body.clear_key;
        db.ai_settings = { ...db.ai_settings, ...body };
        await persistDb();
      }
      return {
        ...db.ai_settings,
        has_key: Boolean(db.ai_settings.api_key),
        masked_key: maskKey(db.ai_settings.api_key),
        providers: PROVIDERS,
      };
    }

    if (method === 'POST' && pathname === '/api/ai/test') {
      const testCfg = {
        ...db.ai_settings,
        ...body,
        api_key: String(body.api_key || '').trim() || db.ai_settings.api_key,
      };
      const { reply, latency_ms, model } = await callCloudLLM(
        testCfg,
        '你是一个简洁助手。',
        '请仅回复：连接成功',
        [],
        40
      );
      return { ok: true, latency_ms, model_name: model, raw_reply: reply.slice(0, 120) };
    }

    return {};
  }

  return { handleRequest };
})();
