# Appendix: the two medical glossaries

These are the knowledge bases sent with every call (Step 2 explains the format, and Step 4
sends them as `knowledgeBase` in `start_call`). Each one is printed here exactly as it is in
the repo.

- [Vietnamese: `prompts/lang/vi.glossary.md`](#vietnamese-promptslangviglossarymd)
- [Mandarin: `prompts/lang/zh.glossary.md`](#mandarin-promptslangzhglossarymd)

Copy each block into its file. Keep the `#` headings and the blank lines: the engine splits
the text into passages at headings and blank lines, so they are part of how it works.

The server reads both files once, when it starts (`loadGlossaries` in `src/languages.js`).
After you change a glossary, restart the server. You do not need `npm run setup`, because
the glossary is not stored on the agent.

## Vietnamese: `prompts/lang/vi.glossary.md`

```markdown
# Chest and breathing symptoms

Chest and breathing symptoms, English and Vietnamese.
chest pain: đau ngực
tightness in the chest: tức ngực, nặng ngực
shortness of breath, trouble breathing: khó thở, hụt hơi
heart racing, palpitations: tim đập nhanh, hồi hộp, đánh trống ngực
wheezing: thở khò khè
cough: ho
coughing up blood: ho ra máu
dizzy, lightheaded: chóng mặt, choáng váng
fainted, passed out: bị ngất, ngất xỉu
pain spreading to the arm or jaw: đau lan ra cánh tay hoặc hàm
sweating: đổ mồ hôi
cold sweat: toát mồ hôi lạnh

# Pain words

Pain words, English and Vietnamese: how a pain feels.
sharp pain: đau nhói, đau buốt
dull pain, aching: đau âm ỉ, đau ê ẩm
burning pain: đau rát, nóng rát
cramping: đau quặn
muscle cramp: chuột rút
throbbing: đau nhức theo nhịp, đau giật giật
stabbing pain: đau như dao đâm
pressure, squeezing: cảm giác bị đè nặng, bị bóp nghẹt
tingling, pins and needles: tê rần, như kim châm
numbness: tê, mất cảm giác
sore, tender to the touch: đau khi chạm vào
constant pain: đau liên tục
pain that comes and goes: đau từng cơn, lúc đau lúc không
pain on a scale from zero to ten: mức đau theo thang điểm từ không đến mười

# Stomach and digestion symptoms

Stomach and digestion symptoms, English and Vietnamese.
stomach ache, abdominal pain: đau bụng
nausea, feeling sick: buồn nôn
vomiting, throwing up: nôn, ói
diarrhea: tiêu chảy
constipation: táo bón
bloating: đầy hơi, chướng bụng
heartburn, acid reflux: ợ nóng, trào ngược axit
loss of appetite: chán ăn, ăn không ngon
blood in the stool: đi ngoài ra máu
black stool: phân đen
indigestion: khó tiêu
belching: ợ hơi
difficulty swallowing: khó nuốt, nuốt nghẹn
weight loss without trying: sụt cân không rõ lý do

# Fever, infection and cold symptoms

Fever, infection and cold symptoms, English and Vietnamese.
fever: sốt
chills, shivering: ớn lạnh, rùng mình
sore throat: đau họng, viêm họng
runny nose: sổ mũi, chảy nước mũi
stuffy nose, congestion: nghẹt mũi
sneezing: hắt hơi
body aches: đau nhức mình mẩy, đau người
fatigue, tiredness: mệt mỏi
swollen glands: sưng hạch
earache: đau tai
infection: nhiễm trùng
flu: cúm
pneumonia: viêm phổi
urinary tract infection: nhiễm trùng đường tiểu
burning when urinating: tiểu buốt, tiểu rát

# Head, nerves and dizziness

Head, nerves and dizziness symptoms, English and Vietnamese.
headache: đau đầu, nhức đầu
migraine: đau nửa đầu
dizziness: chóng mặt
vertigo, the room spinning: hoa mắt chóng mặt, cảm giác quay cuồng
blurred vision: mờ mắt, nhìn mờ
double vision: nhìn đôi, nhìn một thành hai
ringing in the ears: ù tai
weakness on one side: yếu một bên người
face drooping: méo miệng, xệ một bên mặt
slurred speech: nói ngọng, nói líu lưỡi
confusion: lú lẫn, lơ mơ
seizure, convulsion: co giật, động kinh
memory loss: mất trí nhớ, hay quên
trouble sleeping, insomnia: mất ngủ, khó ngủ
loss of balance: mất thăng bằng

# Skin, allergy and swelling

Skin, allergy and swelling symptoms, English and Vietnamese.
rash: phát ban, nổi mẩn
hives: nổi mề đay
itching: ngứa
swelling: sưng, phù
swollen lips or tongue: sưng môi hoặc lưỡi
throat closing up: nghẹn họng, cổ họng bị thắt lại
allergic reaction: dị ứng, phản ứng dị ứng
anaphylaxis: sốc phản vệ
bruise: bầm tím, vết bầm
cut, wound: vết cắt, vết thương
burn: bỏng
blister: phồng rộp, bọng nước
pus, infected wound: mủ, vết thương bị nhiễm trùng
pale: xanh xao, tái nhợt
yellow skin or eyes, jaundice: vàng da, vàng mắt
redness: đỏ, tấy đỏ

# Pregnancy and women's health

Pregnancy and women's health words, English and Vietnamese.
pregnant: có thai, mang thai
could you be pregnant: có thể đang có thai không
last menstrual period: kỳ kinh cuối
period, menstruation: kinh nguyệt, hành kinh
missed period: trễ kinh
heavy bleeding: ra máu nhiều, băng huyết
vaginal bleeding: chảy máu âm đạo
miscarriage: sẩy thai
morning sickness: ốm nghén
contractions: cơn gò, cơn co thắt
due date: ngày dự sinh
breastfeeding: cho con bú
menopause: mãn kinh
pelvic pain: đau vùng chậu
pap test: xét nghiệm tế bào cổ tử cung, xét nghiệm Pap
ultrasound: siêu âm

# Mental health words

Mental health words, English and Vietnamese.
anxiety, anxious: lo âu, lo lắng
depression, depressed: trầm cảm, buồn chán kéo dài
stress: căng thẳng
panic attack: cơn hoảng loạn
thoughts of suicide: ý nghĩ tự tử
thoughts of hurting yourself: ý nghĩ tự làm hại bản thân
hopeless: tuyệt vọng
feeling down, low mood: buồn bã, xuống tinh thần
trouble concentrating: khó tập trung
nightmares: ác mộng
hearing voices: nghe thấy tiếng nói trong đầu
counsellor, therapist: chuyên viên tư vấn tâm lý
psychiatrist: bác sĩ tâm thần
mental health: sức khỏe tâm thần
feeling safe at home: cảm thấy an toàn ở nhà

# Body parts: head and neck

Body parts of the head and neck, English and Vietnamese.
head: đầu
forehead: trán
eye, eyes: mắt
ear, ears: tai
nose: mũi
mouth: miệng
lips: môi
tongue: lưỡi
tooth, teeth: răng
gums: nướu, lợi
jaw: hàm
throat: cổ họng, họng
neck: cổ
back of the neck: gáy
cheek: má
chin: cằm
scalp: da đầu
temple: thái dương

# Body parts: chest, abdomen and back

Body parts of the chest, abdomen and back, English and Vietnamese.
chest: ngực
breast: vú, ngực
heart: tim
lungs: phổi
ribs: xương sườn
stomach, belly: bụng
stomach, the organ: dạ dày, bao tử
upper abdomen: bụng trên
lower abdomen: bụng dưới
side, flank: hông, mạn sườn
liver: gan
kidney: thận
bladder: bàng quang
groin: háng, bẹn
back: lưng
lower back: thắt lưng
spine: cột sống
shoulder blade: bả vai
hip: hông, khớp háng

# Body parts: arms and legs

Body parts of the arms and legs, English and Vietnamese.
shoulder: vai
arm: cánh tay
upper arm: bắp tay
elbow: khuỷu tay, cùi chỏ
forearm: cẳng tay
wrist: cổ tay
hand: bàn tay
finger: ngón tay
thumb: ngón cái
nail: móng
thigh: đùi
knee: đầu gối
shin: ống chân, cẳng chân
calf: bắp chân
ankle: mắt cá chân
foot, feet: bàn chân
heel: gót chân
toe: ngón chân
left: bên trái
right: bên phải
joint: khớp
muscle: cơ bắp
bone: xương

# Medication instruction phrases

Medication instruction phrases, English and Vietnamese.
take one tablet twice a day: uống một viên, hai lần một ngày
with food: uống cùng với thức ăn
before meals: trước bữa ăn
after meals: sau bữa ăn
at bedtime: trước khi đi ngủ
every eight hours: cứ tám tiếng một lần
as needed for pain: uống khi bị đau
do not take with alcohol: không uống cùng với rượu bia
finish the whole course: uống hết toàn bộ thuốc
if you miss a dose: nếu quên một liều
teaspoon: muỗng cà phê, or thìa cà phê in the north

# Medication forms and units

Medication forms and units, English and Vietnamese.
tablet, pill: viên thuốc, viên nén
capsule: viên nang, viên con nhộng
liquid, syrup: thuốc nước, si rô
drops: thuốc nhỏ
eye drops: thuốc nhỏ mắt
cream, ointment: kem bôi, thuốc mỡ
inhaler, puffer: ống hít, bình xịt hen
injection, shot: thuốc tiêm, mũi tiêm
patch: miếng dán
suppository: thuốc đặt
milligram, milligrams: mi li gam
millilitre, millilitres: mi li lít
microgram, micrograms: mi crô gam
unit, units, as for insulin: đơn vị
dose: liều
once a day: một lần một ngày
twice a day: hai lần một ngày
three times a day: ba lần một ngày
over the counter: thuốc không cần toa
prescription medicine: thuốc kê toa

# Common tests and procedures

Common tests and procedures, English and Vietnamese.
blood test: xét nghiệm máu
urine test, urine sample: xét nghiệm nước tiểu, mẫu nước tiểu
x-ray: chụp X quang
CT scan: chụp cắt lớp, chụp CT
MRI: chụp cộng hưởng từ, chụp MRI
ultrasound: siêu âm
electrocardiogram, ECG: điện tâm đồ
blood pressure: huyết áp
temperature: nhiệt độ, thân nhiệt
oxygen level: nồng độ oxy trong máu
IV, intravenous line: truyền tĩnh mạch, đường truyền
stitches: khâu, mũi khâu
cast: bó bột
swab: lấy mẫu bằng tăm bông
biopsy: sinh thiết
surgery, operation: phẫu thuật, mổ
general anesthesia: gây mê
local anesthesia, freezing: gây tê
vaccine, vaccination: vắc xin, tiêm chủng

# Canadian hospital terms

Canadian hospital terms, English and Vietnamese.
triage: phân loại ưu tiên, đánh giá ban đầu khi tiếp nhận
emergency department, emergency room: khoa cấp cứu, phòng cấp cứu
health card: thẻ y tế, thẻ bảo hiểm y tế của tỉnh
family doctor: bác sĩ gia đình
walk-in clinic: phòng khám không cần hẹn trước
prescription: toa thuốc, đơn thuốc
pharmacy, pharmacist: nhà thuốc, dược sĩ
follow-up appointment: hẹn tái khám
discharge, discharged: xuất viện, cho về
admitted to hospital: nhập viện
referral: giấy giới thiệu đến bác sĩ chuyên khoa
specialist: bác sĩ chuyên khoa
nurse: y tá, điều dưỡng
nurse practitioner: điều dưỡng cao cấp có quyền kê toa
waiting room: phòng chờ
ward: khoa, phòng bệnh
outpatient: bệnh nhân ngoại trú
inpatient: bệnh nhân nội trú

# Insurance and paperwork terms

Insurance and paperwork terms, English and Vietnamese.
provincial health insurance, such as OHIP: bảo hiểm y tế của tỉnh
health card number: số thẻ y tế
private insurance: bảo hiểm tư nhân
consent form: giấy đồng ý, giấy chấp thuận
sign here: ký tên ở đây
date of birth: ngày sinh
address: địa chỉ
phone number: số điện thoại
emergency contact: người liên lạc khi khẩn cấp
next of kin: thân nhân
medical history: tiền sử bệnh
sick note, doctor's note: giấy xác nhận nghỉ bệnh
interpreter services, language services: dịch vụ thông dịch
social worker: nhân viên xã hội
patient relations: bộ phận quan hệ bệnh nhân
bill, invoice: hóa đơn
coverage: phạm vi bảo hiểm

# Words easy to mishear (Vietnamese tones)

Vietnamese words easy to mishear because their tones are close; check the meaning in context.
đau (pain) and đầu (head) and đâu (where)
ba (three) and bà (grandmother, Missus)
năm (five, or year) and nằm (lie down)
mười (ten) and mươi (tens, as in hai mươi, twenty)
bốn (four) and bón (as in táo bón, constipation)
hai (two) and hay (or, often)
sáu (six) and sâu (deep)
chín (nine) and chính (main)
tim (heart) and tím (purple) and tìm (look for)
mắt (eye) and mặt (face) and mất (lose)
tai (ear) and tay (hand, arm)
ho (cough) and họ (they, family name)
sốt (fever) and sót (left out)
ngực (chest) and ngứa (itch)
không (no, zero) and khó (hard, as in khó thở, trouble breathing)
tê (numb) and tệ (bad)
mũi (nose) and mùi (smell)

# Words easy to mishear (English drug names and numbers)

English drug names and numbers easy to mishear; check with the speaker when unsure.
fifteen and fifty, sixteen and sixty, seventeen and seventy, eighteen and eighty, thirteen and thirty, fourteen and forty
milligrams and millilitres
twice a day and twice a week
every four hours and every fourteen hours
hydroxyzine and hydralazine
Celebrex and Celexa
clonidine and clonazepam, also called Klonopin
metformin and metoprolol
Lasix, furosemide, and Losec, omeprazole
prednisone and prednisolone
Zantac and Xanax
amoxicillin and ampicillin
morphine and hydromorphone
Tylenol is acetaminophen, called paracetamol in Vietnam: Tylenol là acetaminophen, ở Việt Nam gọi là paracetamol
Advil and Motrin are ibuprofen
```

## Mandarin: `prompts/lang/zh.glossary.md`

```markdown
# Chest and breathing symptoms

Chest and breathing symptoms, English and Mandarin.
chest pain: 胸痛, 胸口痛
tightness in the chest: 胸闷, 胸口发紧
shortness of breath, trouble breathing: 呼吸困难, 喘不过气, 气短
heart racing, palpitations: 心跳很快, 心悸, 心慌
wheezing: 喘, 呼吸时有嘶嘶声
cough: 咳嗽
coughing up blood: 咳血, 咳出血来
dizzy, lightheaded: 头晕, 头昏
fainted, passed out: 晕倒, 昏倒
pain spreading to the arm or jaw: 疼痛扩散到手臂或下颌
sweating: 出汗
cold sweat: 冒冷汗

# Pain words

Pain words, English and Mandarin: how a pain feels.
sharp pain: 刺痛, 尖锐的痛
dull pain, aching: 隐隐作痛, 酸痛, 钝痛
burning pain: 灼痛, 火辣辣地痛
cramping: 绞痛, 一阵一阵绞着痛
muscle cramp: 抽筋
throbbing: 一跳一跳地痛, 搏动性疼痛
stabbing pain: 像刀扎一样痛
pressure, squeezing: 压迫感, 像被捏紧一样
tingling, pins and needles: 发麻, 像针扎一样麻
numbness: 麻木, 没知觉
sore, tender to the touch: 一碰就痛, 压痛
constant pain: 一直痛, 持续疼痛
pain that comes and goes: 时痛时不痛, 一阵一阵痛
pain on a scale from zero to ten: 疼痛程度从零到十分打分

# Stomach and digestion symptoms

Stomach and digestion symptoms, English and Mandarin.
stomach ache, abdominal pain: 肚子痛, 腹痛
nausea, feeling sick: 恶心, 想吐
vomiting, throwing up: 呕吐, 吐
diarrhea: 拉肚子, 腹泻
constipation: 便秘
bloating: 腹胀, 胀气
heartburn, acid reflux: 烧心, 胃酸反流 (Taiwan: 胃食道逆流)
loss of appetite: 没胃口, 食欲不振
blood in the stool: 大便带血, 便血
black stool: 黑便, 大便发黑
indigestion: 消化不良
belching: 打嗝, 嗳气
difficulty swallowing: 吞咽困难, 吞东西卡住
weight loss without trying: 不明原因体重下降, 无故变瘦

# Fever, infection and cold symptoms

Fever, infection and cold symptoms, English and Mandarin.
fever: 发烧, 发热
chills, shivering: 发冷, 打寒战
sore throat: 喉咙痛, 嗓子疼
runny nose: 流鼻涕
stuffy nose, congestion: 鼻塞
sneezing: 打喷嚏
body aches: 全身酸痛
fatigue, tiredness: 疲倦, 乏力, 没力气
swollen glands: 淋巴结肿大
earache: 耳朵痛
infection: 感染
flu: 流感
pneumonia: 肺炎
urinary tract infection: 尿路感染 (Taiwan: 泌尿道感染)
burning when urinating: 小便时灼痛, 尿尿时刺痛

# Head, nerves and dizziness

Head, nerves and dizziness symptoms, English and Mandarin.
headache: 头痛, 头疼
migraine: 偏头痛
dizziness: 头晕
vertigo, the room spinning: 眩晕, 天旋地转
blurred vision: 视力模糊, 看东西模糊
double vision: 看东西重影, 复视
ringing in the ears: 耳鸣
weakness on one side: 半边身体无力
face drooping: 嘴歪, 脸一边下垂
slurred speech: 说话含糊, 口齿不清
confusion: 意识不清, 糊涂
seizure, convulsion: 抽搐, 癫痫发作
memory loss: 记忆力减退, 健忘
trouble sleeping, insomnia: 失眠, 睡不着
loss of balance: 站不稳, 失去平衡

# Skin, allergy and swelling

Skin, allergy and swelling symptoms, English and Mandarin.
rash: 皮疹, 起疹子
hives: 荨麻疹, 风疹块
itching: 痒
swelling: 肿, 水肿
swollen lips or tongue: 嘴唇或舌头肿
throat closing up: 喉咙发紧, 喉咙像被堵住
allergic reaction: 过敏, 过敏反应
anaphylaxis: 过敏性休克
bruise: 瘀青, 淤血
cut, wound: 伤口, 割伤
burn: 烫伤, 烧伤
blister: 水泡
pus, infected wound: 脓, 伤口化脓
pale: 脸色苍白
yellow skin or eyes, jaundice: 皮肤或眼睛发黄, 黄疸
redness: 发红, 红肿

# Pregnancy and women's health

Pregnancy and women's health words, English and Mandarin.
pregnant: 怀孕, 有身孕
could you be pregnant: 有可能怀孕吗
last menstrual period: 末次月经, 上次月经是什么时候
period, menstruation: 月经, 例假
missed period: 月经没来, 推迟
heavy bleeding: 出血很多, 大出血
vaginal bleeding: 阴道出血
miscarriage: 流产
morning sickness: 孕吐
contractions: 宫缩, 阵痛
due date: 预产期
breastfeeding: 母乳喂养, 喂奶
menopause: 更年期, 绝经
pelvic pain: 盆腔痛 (Taiwan: 骨盆腔痛)
pap test: 宫颈涂片, 宫颈癌筛查 (Taiwan: 子宫颈抹片)
ultrasound: 超声, B超 (Taiwan: 超音波)

# Mental health words

Mental health words, English and Mandarin.
anxiety, anxious: 焦虑, 紧张不安
depression, depressed: 抑郁, 情绪低落 (Taiwan: 忧郁)
stress: 压力, 压力大
panic attack: 惊恐发作
thoughts of suicide: 想自杀, 有自杀的念头
thoughts of hurting yourself: 想伤害自己
hopeless: 绝望, 看不到希望
feeling down, low mood: 心情低落, 情绪不好
trouble concentrating: 难以集中注意力
nightmares: 噩梦, 做噩梦
hearing voices: 听到不存在的声音
counsellor, therapist: 心理咨询师 (Taiwan: 心理咨商师), 心理治疗师
psychiatrist: 精神科医生
mental health: 心理健康, 精神健康
feeling safe at home: 在家里觉得安全

# Body parts: head and neck

Body parts of the head and neck, English and Mandarin.
head: 头
forehead: 额头
eye, eyes: 眼睛
ear, ears: 耳朵
nose: 鼻子
mouth: 嘴, 口
lips: 嘴唇
tongue: 舌头
tooth, teeth: 牙齿, 牙
gums: 牙龈
jaw: 下颌, 下巴
throat: 喉咙, 嗓子
neck: 脖子, 颈部
back of the neck: 后颈, 脖子后面
cheek: 脸颊, 腮
chin: 下巴
scalp: 头皮
temple: 太阳穴

# Body parts: chest, abdomen and back

Body parts of the chest, abdomen and back, English and Mandarin.
chest: 胸口, 胸
breast: 乳房
heart: 心脏
lungs: 肺
ribs: 肋骨
stomach, belly: 肚子, 腹部
stomach, the organ: 胃
upper abdomen: 上腹部
lower abdomen: 下腹部, 小腹
side, flank: 腰侧, 侧腹
liver: 肝
kidney: 肾, 肾脏
bladder: 膀胱
groin: 大腿根, 腹股沟
back: 背, 后背
lower back: 腰
spine: 脊柱, 脊椎
shoulder blade: 肩胛骨
hip: 髋部, 胯

# Body parts: arms and legs

Body parts of the arms and legs, English and Mandarin.
shoulder: 肩膀
arm: 手臂, 胳膊
upper arm: 上臂, 大臂
elbow: 手肘, 胳膊肘
forearm: 前臂, 小臂
wrist: 手腕
hand: 手
finger: 手指
thumb: 大拇指
nail: 指甲
thigh: 大腿
knee: 膝盖
shin: 小腿前侧, 胫骨
calf: 小腿肚
ankle: 脚踝
foot, feet: 脚
heel: 脚后跟
toe: 脚趾
left: 左边
right: 右边
joint: 关节
muscle: 肌肉
bone: 骨头

# Medication instruction phrases

Medication instruction phrases, English and Mandarin.
take one tablet twice a day: 每次吃一片, 每天吃两次
with food: 随餐吃, 和食物一起吃
before meals: 饭前吃
after meals: 饭后吃
at bedtime: 睡前吃
every eight hours: 每隔八个小时吃一次
as needed for pain: 痛的时候再吃
do not take with alcohol: 不要和酒一起吃
finish the whole course: 把药吃完
if you miss a dose: 如果漏吃了一次
teaspoon: 茶匙, 小勺

# Medication forms and units

Medication forms and units, English and Mandarin.
tablet, pill: 药片, 药丸 (Taiwan: 药锭)
capsule: 胶囊
liquid, syrup: 药水, 糖浆
drops: 滴剂
eye drops: 眼药水
cream, ointment: 药膏, 软膏
inhaler, puffer: 吸入器, 喷雾剂, 哮喘吸入器 (Taiwan: 气喘吸入器)
injection, shot: 打针, 注射
patch: 药贴, 贴片 (Taiwan: 贴布)
suppository: 栓剂, 塞剂
milligram, milligrams: 毫克
millilitre, millilitres: 毫升
microgram, micrograms: 微克
unit, units, as for insulin: 单位
dose: 剂量
once a day: 每天一次
twice a day: 每天两次
three times a day: 每天三次
over the counter: 非处方药, 不用开处方的药 (Taiwan: 成药)
prescription medicine: 处方药

# Common tests and procedures

Common tests and procedures, English and Mandarin.
blood test: 验血, 抽血检查
urine test, urine sample: 验尿, 尿样
x-ray: X光, 拍X光片
CT scan: CT, 电脑断层 (Taiwan)
MRI: 核磁共振 (Taiwan: 磁振造影)
ultrasound: 超声, B超 (Taiwan: 超音波)
electrocardiogram, ECG: 心电图
blood pressure: 血压
temperature: 体温
oxygen level: 血氧, 血氧浓度
IV, intravenous line: 静脉输液, 打点滴
stitches: 缝针, 缝合
cast: 打石膏
swab: 棉签取样, 拭子
biopsy: 活检 (Taiwan: 切片检查)
surgery, operation: 手术, 开刀
general anesthesia: 全身麻醉
local anesthesia, freezing: 局部麻醉, 打麻药
vaccine, vaccination: 疫苗, 打疫苗

# Canadian hospital terms

Canadian hospital terms, English and Mandarin.
triage: 分诊 (Taiwan: 检伤分类)
emergency department, emergency room: 急诊室, 急诊科
health card: 健康卡, 医疗卡 (Taiwan visitors may say 健保卡)
family doctor: 家庭医生 (Taiwan: 家庭医师)
walk-in clinic: 免预约诊所, 不用预约的诊所
prescription: 处方, 药方
pharmacy, pharmacist: 药房, 药剂师 (Taiwan: 药局)
follow-up appointment: 复诊预约 (Taiwan: 回诊)
discharge, discharged: 出院, 让你回家
admitted to hospital: 住院
referral: 转诊, 转诊单 (Taiwan: 转介单)
specialist: 专科医生
nurse: 护士 (Taiwan: 护理师)
nurse practitioner: 执业护士
waiting room: 候诊室
ward: 病房
outpatient: 门诊病人
inpatient: 住院病人

# Insurance and paperwork terms

Insurance and paperwork terms, English and Mandarin.
provincial health insurance, such as OHIP: 省医疗保险, 省医保
health card number: 健康卡号码
private insurance: 私人保险
consent form: 同意书
sign here: 请在这里签名
date of birth: 出生日期, 生日
address: 地址
phone number: 电话号码
emergency contact: 紧急联系人
next of kin: 近亲
medical history: 病史
sick note, doctor's note: 病假条
interpreter services, language services: 口译服务, 语言服务
social worker: 社工
patient relations: 患者联络部门
bill, invoice: 账单
coverage: 保障范围, 保险覆盖范围

# Words easy to mishear (Mandarin tones)

Mandarin words easy to mishear because their sounds or tones are close; check the meaning in context.
胃 wèi (stomach) and 肺 fèi (lung)
晕 yūn (dizzy) and 孕 yùn (pregnant)
腰 yāo (lower back) and 药 yào (medicine)
咳 ké (cough) and 渴 kě (thirsty)
耳 ěr (ear) and 二 èr (two)
牙 yá (tooth) and 眼 yǎn (eye)
四 sì (four) and 十 shí (ten), also 十四 and 四十
十 shí (ten) and 是 shì (yes)
五 wǔ (five) and 无 wú (none)
六 liù (six) and 流 liú (flow, as in 流血, bleeding)
九 jiǔ (nine) and 酒 jiǔ (alcohol)
二 èr and 两 liǎng (both mean two)
痒 yǎng (itch) and 胀 zhàng (bloated)
高 gāo (high) and 低 dī (low), for blood pressure

# Words easy to mishear (English drug names and numbers)

English drug names and numbers easy to mishear; check with the speaker when unsure.
fifteen and fifty, sixteen and sixty, seventeen and seventy, eighteen and eighty, thirteen and thirty, fourteen and forty
milligrams and millilitres
twice a day and twice a week
every four hours and every fourteen hours
hydroxyzine and hydralazine
Celebrex and Celexa
clonidine and clonazepam, also called Klonopin
metformin and metoprolol
Lasix, furosemide, and Losec, omeprazole
prednisone and prednisolone
Zantac and Xanax
amoxicillin and ampicillin
morphine and hydromorphone
Tylenol is acetaminophen: Tylenol 是对乙酰氨基酚, 也叫扑热息痛, 台湾叫普拿疼
Advil and Motrin are ibuprofen: 布洛芬
```

Back to [Step 2: the agent's brain](02-agent-brain.md).
