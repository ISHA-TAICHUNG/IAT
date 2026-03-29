// ===== 多語言支援 (i18n) =====

const LANGS = {
  'zh-TW': { label: '繁體中文', flag: '🇹🇼', native: '中文' },
  'vi':    { label: 'Tiếng Việt', flag: '🇻🇳', native: 'Tiếng Việt' },
  'id':    { label: 'Bahasa Indonesia', flag: '🇮🇩', native: 'Indonesia' },
  'th':    { label: 'ภาษาไทย', flag: '🇹🇭', native: 'ไทย' },
  'en':    { label: 'English', flag: '🇵🇭', native: 'English' },
};

// 語言 → 題庫 ID 後綴對應
const LANG_CAT_SUFFIX = {
  'zh-TW': null,       // 顯示全部
  'vi':    '_越南',
  'id':    '_印尼',
  'th':    '_泰國',
  'en':    '_菲律賓',
};

// 職類名稱翻譯
const CAT_NAMES = {
  '堆高機':       { vi: 'Xe nâng', id: 'Forklift', th: 'รถยก', en: 'Forklift' },
  '固定式起重機': { vi: 'Cần trục cố định', id: 'Crane tetap', th: 'เครนชนิดอยู่กับที่', en: 'Fixed Crane' },
  '移動式起重機': { vi: 'Cần trục di động', id: 'Crane bergerak', th: 'เครนเคลื่อนที่', en: 'Mobile Crane' },
  '一壓':         { vi: 'Bình áp lực loại 1', id: 'Bejana tekan tipe 1', th: 'ภาชนะรับแรงดันประเภท 1', en: 'Pressure Vessel Type 1' },
};

// ===== 翻譯字串 =====
const I18N = {
  // ---------- 頁面標題 ----------
  'site.title': {
    'zh-TW': '管理職類暨即測即評電腦化測驗 線上練習',
    vi: 'Luyện tập trực tuyến - Kiểm tra an toàn lao động',
    id: 'Latihan Online - Ujian Keselamatan Kerja',
    th: 'ฝึกฝนออนไลน์ - สอบความปลอดภัยในการทำงาน',
    en: 'Online Practice - Occupational Safety Exam',
  },
  'site.header': {
    'zh-TW': '管理職類測驗 線上練習',
    vi: 'Luyện tập kiểm tra trực tuyến',
    id: 'Latihan Ujian Online',
    th: 'ฝึกฝนสอบออนไลน์',
    en: 'Online Exam Practice',
  },
  'site.subtitle': {
    'zh-TW': '職業安全衛生 — 即測即評',
    vi: 'An toàn & Sức khỏe nghề nghiệp',
    id: 'Keselamatan & Kesehatan Kerja',
    th: 'ความปลอดภัยและอาชีวอนามัย',
    en: 'Occupational Safety & Health',
  },
  'notice.title': {
    'zh-TW': '使用前須知',
    vi: 'Lưu ý trước khi sử dụng',
    id: 'Pemberitahuan Sebelum Digunakan',
    th: 'ข้อควรทราบก่อนใช้งาน',
    en: 'Notice Before Use',
  },
  'notice.p1': {
    'zh-TW': '本網站題目僅供參考使用，內容可能因法規更新尚未修正，或題目本身仍有疏漏，請以最新法規為準。',
    vi: 'Các câu hỏi trên trang web này chỉ để tham khảo. Nội dung có thể chưa được cập nhật theo quy định mới nhất.',
    id: 'Soal-soal di situs ini hanya untuk referensi. Konten mungkin belum diperbarui sesuai peraturan terbaru.',
    th: 'คำถามในเว็บไซต์นี้เป็นเพียงข้อมูลอ้างอิง เนื้อหาอาจยังไม่ได้อัปเดตตามกฎระเบียบล่าสุด',
    en: 'Questions on this website are for reference only. Content may not be updated according to the latest regulations.',
  },
  'notice.btn': {
    'zh-TW': '我已了解，開始練習',
    vi: 'Tôi đã hiểu, bắt đầu luyện tập',
    id: 'Saya mengerti, mulai latihan',
    th: 'ฉันเข้าใจแล้ว เริ่มฝึกฝน',
    en: 'I understand, start practicing',
  },
  'preexam.cancel': { 'zh-TW': '取消', vi: 'Hủy', id: 'Batal', th: 'ยกเลิก', en: 'Cancel' },
  'preexam.start': { 'zh-TW': '開始測驗', vi: 'Bắt đầu kiểm tra', id: 'Mulai Ujian', th: 'เริ่มสอบ', en: 'Start Exam' },
  'select.heading': { 'zh-TW': '選擇練習職類', vi: 'Chọn loại hình luyện tập', id: 'Pilih Jenis Latihan', th: 'เลือกประเภทการฝึก', en: 'Select Practice Category' },
  'select.desc': {
    'zh-TW': '從下拉選單選取職類，系統將隨機抽選題目作答，滿分 100 分，60 分及格。',
    vi: 'Chọn loại hình từ danh sách, hệ thống sẽ chọn ngẫu nhiên câu hỏi. Điểm tối đa 100, đạt 60 điểm.',
    id: 'Pilih jenis dari daftar, sistem akan memilih soal secara acak. Skor maksimal 100, lulus 60.',
    th: 'เลือกประเภทจากรายการ ระบบจะสุ่มเลือกคำถาม คะแนนเต็ม 100 ผ่าน 60',
    en: 'Select a category. Questions are randomly selected. Full score 100, passing score 60.',
  },
  'select.placeholder': { 'zh-TW': '— 請選擇職類 —', vi: '— Vui lòng chọn —', id: '— Silakan pilih —', th: '— กรุณาเลือก —', en: '— Please select —' },
  'select.category': { 'zh-TW': '選擇職類', vi: 'Chọn loại hình', id: 'Pilih Jenis', th: 'เลือกประเภท', en: 'Select Category' },
  'select.mode': { 'zh-TW': '選擇模式', vi: 'Chọn chế độ', id: 'Pilih Mode', th: 'เลือกโหมด', en: 'Select Mode' },
  'select.start': { 'zh-TW': '開始測驗', vi: 'Bắt đầu', id: 'Mulai', th: 'เริ่ม', en: 'Start' },
  'select.loading': { 'zh-TW': '載入職類中…', vi: 'Đang tải...', id: 'Memuat...', th: 'กำลังโหลด...', en: 'Loading...' },
  'mode.normal': { 'zh-TW': '標準模式', vi: 'Chế độ tiêu chuẩn', id: 'Mode Standar', th: 'โหมดมาตรฐาน', en: 'Standard Mode' },
  'mode.speed': { 'zh-TW': '急速模式', vi: 'Chế độ nhanh', id: 'Mode Cepat', th: 'โหมดเร็ว', en: 'Speed Mode' },
  'mode.questions': { 'zh-TW': '題', vi: 'câu', id: 'soal', th: 'ข้อ', en: 'Qs' },
  'mode.minutes': { 'zh-TW': '分鐘', vi: 'phút', id: 'menit', th: 'นาที', en: 'min' },
  'info.timed': { 'zh-TW': '限時作答', vi: 'Giới hạn thời gian', id: 'Waktu Terbatas', th: 'จำกัดเวลา', en: 'Timed Exam' },
  'info.timed.detail': { 'zh-TW': '標準 80 題 / 急速 20 題', vi: 'Tiêu chuẩn 80 câu / Nhanh 20 câu', id: 'Standar 80 soal / Cepat 20 soal', th: 'มาตรฐาน 80 ข้อ / เร็ว 20 ข้อ', en: 'Standard 80 Qs / Speed 20 Qs' },
  'info.instant': { 'zh-TW': '即時作答判斷', vi: 'Kết quả tức thì', id: 'Hasil Langsung', th: 'ผลทันที', en: 'Instant Results' },
  'info.instant.detail': { 'zh-TW': '答完立即顯示對錯', vi: 'Hiển thị đúng/sai ngay', id: 'Tampilkan benar/salah langsung', th: 'แสดงถูก/ผิดทันที', en: 'Shows correct/wrong immediately' },
  'info.feedback': { 'zh-TW': '題目反饋機制', vi: 'Phản hồi câu hỏi', id: 'Umpan Balik Soal', th: 'แจ้งปัญหาคำถาม', en: 'Question Feedback' },
  'info.feedback.detail': { 'zh-TW': '協助維護題庫品質', vi: 'Giúp cải thiện chất lượng', id: 'Bantu tingkatkan kualitas', th: 'ช่วยปรับปรุงคุณภาพ', en: 'Help improve quality' },
  'cat.total.prefix': { 'zh-TW': '題庫共', vi: 'Tổng cộng', id: 'Total', th: 'ทั้งหมด', en: 'Total' },
  'cat.total.suffix': { 'zh-TW': '題，隨機抽選作答', vi: 'câu, chọn ngẫu nhiên', id: 'soal, dipilih acak', th: 'ข้อ สุ่มเลือก', en: 'questions, randomly selected' },
  'exam.title': { 'zh-TW': '作答中 — 管理職類測驗線上練習', vi: 'Đang kiểm tra', id: 'Sedang Ujian', th: 'กำลังสอบ', en: 'Exam in Progress' },
  'exam.loading': { 'zh-TW': '載入題庫中…', vi: 'Đang tải câu hỏi...', id: 'Memuat soal...', th: 'กำลังโหลดคำถาม...', en: 'Loading questions...' },
  'exam.q.prefix': { 'zh-TW': '第 ', vi: 'Câu ', id: 'Soal ', th: 'ข้อ ', en: 'Q' },
  'exam.q.of': { 'zh-TW': ' 題 / 共 ', vi: ' / Tổng ', id: ' / Total ', th: ' / ทั้งหมด ', en: ' of ' },
  'exam.q.unit': { 'zh-TW': ' 題', vi: ' câu', id: ' soal', th: ' ข้อ', en: '' },
  'exam.answered': { 'zh-TW': '已答', vi: 'Đã trả lời', id: 'Dijawab', th: 'ตอบแล้ว', en: 'Answered' },
  'exam.btn.end': { 'zh-TW': '提前結束', vi: 'Kết thúc sớm', id: 'Akhiri', th: 'จบก่อน', en: 'End Early' },
  'exam.btn.prev': { 'zh-TW': '← 上一題', vi: '← Trước', id: '← Sebelumnya', th: '← ก่อนหน้า', en: '← Previous' },
  'exam.btn.next': { 'zh-TW': '下一題 →', vi: 'Tiếp →', id: 'Berikutnya →', th: 'ถัดไป →', en: 'Next →' },
  'exam.btn.finish': { 'zh-TW': '查看成績 →', vi: 'Xem kết quả →', id: 'Lihat Hasil →', th: 'ดูผลสอบ →', en: 'View Results →' },
  'exam.btn.hint': { 'zh-TW': '💡 查看答案', vi: '💡 Xem đáp án', id: '💡 Lihat Jawaban', th: '💡 ดูคำตอบ', en: '💡 Show Answer' },
  'exam.btn.feedback': { 'zh-TW': '💬 反饋', vi: '💬 Phản hồi', id: '💬 Umpan Balik', th: '💬 แจ้งปัญหา', en: '💬 Feedback' },
  'exam.correct': { 'zh-TW': '✅ 答對了！', vi: '✅ Đúng rồi!', id: '✅ Benar!', th: '✅ ถูกต้อง!', en: '✅ Correct!' },
  'exam.wrong.prefix': { 'zh-TW': '❌ 答錯了，正確答案為：', vi: '❌ Sai rồi, đáp án đúng là:', id: '❌ Salah, jawaban benar:', th: '❌ ผิด คำตอบที่ถูกคือ:', en: '❌ Wrong, correct answer:' },
  'exam.hint.prefix': { 'zh-TW': '💡 正確答案為：', vi: '💡 Đáp án đúng là:', id: '💡 Jawaban benar:', th: '💡 คำตอบที่ถูกคือ:', en: '💡 Correct answer:' },
  'exam.hint.suffix': { 'zh-TW': '（已查看答案，此題不列入計分）', vi: '(Đã xem đáp án, không tính điểm)', id: '(Sudah lihat jawaban, tidak dihitung)', th: '(ดูคำตอบแล้ว ไม่นับคะแนน)', en: '(Answer viewed, not scored)' },
  'exam.noscore': { 'zh-TW': '💡 此題不列入計分', vi: '💡 Câu này không tính điểm', id: '💡 Soal ini tidak dihitung', th: '💡 ข้อนี้ไม่นับคะแนน', en: '💡 Not scored' },
  'exam.bookmark.add': { 'zh-TW': '收藏此題', vi: 'Đánh dấu', id: 'Tandai', th: 'บุ๊คมาร์ก', en: 'Bookmark' },
  'exam.bookmark.remove': { 'zh-TW': '取消收藏', vi: 'Bỏ đánh dấu', id: 'Hapus tanda', th: 'ยกเลิกบุ๊คมาร์ก', en: 'Remove bookmark' },
  'exam.timeup': { 'zh-TW': '⏰ 時間到！自動交卷', vi: '⏰ Hết giờ! Tự động nộp bài', id: '⏰ Waktu habis! Otomatis dikumpulkan', th: '⏰ หมดเวลา! ส่งอัตโนมัติ', en: '⏰ Time up! Auto-submitted' },
  'exam.nav.expand': { 'zh-TW': '▼ 展開題目導覽', vi: '▼ Mở danh sách', id: '▼ Buka navigasi', th: '▼ เปิดเมนู', en: '▼ Expand' },
  'exam.nav.collapse': { 'zh-TW': '▲ 收合題目導覽', vi: '▲ Đóng danh sách', id: '▲ Tutup navigasi', th: '▲ ปิดเมนู', en: '▲ Collapse' },
  'exam.review.suffix': { 'zh-TW': '（錯題複習）', vi: '(Ôn tập câu sai)', id: '(Review soal salah)', th: '(ทบทวนข้อผิด)', en: '(Error Review)' },
  'exam.speed.suffix': { 'zh-TW': '（急速模式）', vi: '(Chế độ nhanh)', id: '(Mode Cepat)', th: '(โหมดเร็ว)', en: '(Speed Mode)' },
  'endmodal.title': { 'zh-TW': '確定要提前結束？', vi: 'Bạn muốn kết thúc sớm?', id: 'Yakin ingin mengakhiri?', th: 'แน่ใจว่าจะจบก่อน?', en: 'End exam early?' },
  'endmodal.body': { 'zh-TW': '尚未作答的題目將不計分，確定要結束並查看成績嗎？', vi: 'Các câu chưa trả lời sẽ không được tính điểm. Bạn có chắc chắn?', id: 'Soal yang belum dijawab tidak akan dinilai. Yakin?', th: 'ข้อที่ยังไม่ตอบจะไม่ได้คะแนน แน่ใจหรือไม่?', en: 'Unanswered questions won\'t be scored. Are you sure?' },
  'endmodal.continue': { 'zh-TW': '繼續作答', vi: 'Tiếp tục', id: 'Lanjutkan', th: 'ทำต่อ', en: 'Continue' },
  'endmodal.confirm': { 'zh-TW': '確定結束', vi: 'Kết thúc', id: 'Akhiri', th: 'จบ', en: 'End Exam' },
  'fb.title': { 'zh-TW': '💬 題目反饋', vi: '💬 Phản hồi câu hỏi', id: '💬 Umpan Balik Soal', th: '💬 แจ้งปัญหาคำถาม', en: '💬 Question Feedback' },
  'fb.type': { 'zh-TW': '反饋類型', vi: 'Loại phản hồi', id: 'Jenis', th: 'ประเภท', en: 'Type' },
  'fb.type.q': { 'zh-TW': '題目有誤', vi: 'Câu hỏi sai', id: 'Soal salah', th: 'คำถามผิด', en: 'Wrong question' },
  'fb.type.a': { 'zh-TW': '答案有誤', vi: 'Đáp án sai', id: 'Jawaban salah', th: 'คำตอบผิด', en: 'Wrong answer' },
  'fb.type.o': { 'zh-TW': '選項有誤', vi: 'Lựa chọn sai', id: 'Opsi salah', th: 'ตัวเลือกผิด', en: 'Wrong option' },
  'fb.type.other': { 'zh-TW': '其他', vi: 'Khác', id: 'Lainnya', th: 'อื่นๆ', en: 'Other' },
  'fb.desc': { 'zh-TW': '補充說明（選填）', vi: 'Mô tả thêm (tùy chọn)', id: 'Keterangan tambahan (opsional)', th: 'รายละเอียดเพิ่มเติม (ไม่บังคับ)', en: 'Additional details (optional)' },
  'fb.placeholder': { 'zh-TW': '請描述問題…', vi: 'Mô tả vấn đề...', id: 'Jelaskan masalahnya...', th: 'อธิบายปัญหา...', en: 'Describe the issue...' },
  'fb.cancel': { 'zh-TW': '取消', vi: 'Hủy', id: 'Batal', th: 'ยกเลิก', en: 'Cancel' },
  'fb.submit': { 'zh-TW': '送出', vi: 'Gửi', id: 'Kirim', th: 'ส่ง', en: 'Submit' },
  'fb.success': { 'zh-TW': '✅ 反饋已送出，感謝你！', vi: '✅ Đã gửi, cảm ơn bạn!', id: '✅ Terkirim, terima kasih!', th: '✅ ส่งเรียบร้อย ขอบคุณ!', en: '✅ Submitted, thank you!' },
  'fb.error': { 'zh-TW': '⚠️ 反饋送出失敗，請檢查網路連線。', vi: '⚠️ Gửi thất bại, kiểm tra mạng.', id: '⚠️ Gagal mengirim, periksa koneksi.', th: '⚠️ ส่งไม่สำเร็จ ตรวจสอบเครือข่าย', en: '⚠️ Failed to submit, check connection.' },
  'result.title': { 'zh-TW': '測驗成績', vi: 'Kết quả kiểm tra', id: 'Hasil Ujian', th: 'ผลสอบ', en: 'Exam Results' },
  'result.loading': { 'zh-TW': '計算中…', vi: 'Đang tính...', id: 'Menghitung...', th: 'กำลังคำนวณ...', en: 'Calculating...' },
  'result.correct': { 'zh-TW': '答對：', vi: 'Đúng:', id: 'Benar:', th: 'ถูก:', en: 'Correct:' },
  'result.wrong': { 'zh-TW': '答錯：', vi: 'Sai:', id: 'Salah:', th: 'ผิด:', en: 'Wrong:' },
  'result.hinted': { 'zh-TW': '看答案：', vi: 'Xem đáp án:', id: 'Lihat jawaban:', th: 'ดูคำตอบ:', en: 'Viewed:' },
  'result.skipped': { 'zh-TW': '未答：', vi: 'Bỏ qua:', id: 'Dilewati:', th: 'ไม่ตอบ:', en: 'Skipped:' },
  'result.time': { 'zh-TW': '用時：', vi: 'Thời gian:', id: 'Waktu:', th: 'เวลา:', en: 'Time:' },
  'result.disclaimer': { 'zh-TW': '※ 查看答案的題目不列入計分。60 分及格。', vi: '※ Câu đã xem đáp án không tính điểm. Đạt 60.', id: '※ Soal yang dilihat jawabannya tidak dihitung. Lulus 60.', th: '※ ข้อที่ดูคำตอบไม่นับคะแนน ผ่าน 60', en: '※ Viewed answers not scored. Pass: 60.' },
  'result.btn.home': { 'zh-TW': '← 選擇其他職類', vi: '← Chọn loại khác', id: '← Pilih jenis lain', th: '← เลือกประเภทอื่น', en: '← Choose another' },
  'result.btn.retry': { 'zh-TW': '🔄 重新練習', vi: '🔄 Làm lại', id: '🔄 Ulangi', th: '🔄 ทำใหม่', en: '🔄 Retry' },
  'result.btn.review': { 'zh-TW': '📝 只練錯題', vi: '📝 Ôn câu sai', id: '📝 Review salah', th: '📝 ทบทวนข้อผิด', en: '📝 Review errors' },
  'result.perfect': { 'zh-TW': '🌟 全部答對！', vi: '🌟 Đúng hết!', id: '🌟 Semua benar!', th: '🌟 ถูกทั้งหมด!', en: '🌟 Perfect score!' },
  'result.pass': { 'zh-TW': '及格', vi: 'Đạt', id: 'Lulus', th: 'ผ่าน', en: 'Pass' },
  'result.fail': { 'zh-TW': '未及格', vi: 'Không đạt', id: 'Tidak lulus', th: 'ไม่ผ่าน', en: 'Fail' },
  'result.score.unit': { 'zh-TW': '分', vi: 'điểm', id: 'poin', th: 'คะแนน', en: 'pts' },
  'result.your.answer': { 'zh-TW': '你的答案：', vi: 'Đáp án của bạn:', id: 'Jawaban Anda:', th: 'คำตอบของคุณ:', en: 'Your answer:' },
  'result.correct.answer': { 'zh-TW': '正確答案：', vi: 'Đáp án đúng:', id: 'Jawaban benar:', th: 'คำตอบที่ถูก:', en: 'Correct answer:' },
  'result.status.hinted': { 'zh-TW': '（已查看答案）', vi: '(Đã xem đáp án)', id: '(Sudah lihat jawaban)', th: '(ดูคำตอบแล้ว)', en: '(Answer viewed)' },
  'result.status.skipped': { 'zh-TW': '（未作答）', vi: '(Chưa trả lời)', id: '(Belum dijawab)', th: '(ไม่ได้ตอบ)', en: '(Skipped)' },
  'result.status.wrong': { 'zh-TW': '（答錯）', vi: '(Sai)', id: '(Salah)', th: '(ผิด)', en: '(Wrong)' },
  'result.history': { 'zh-TW': '📊 最近成績紀錄', vi: '📊 Lịch sử gần đây', id: '📊 Riwayat terbaru', th: '📊 ประวัติล่าสุด', en: '📊 Recent history' },
  'result.current': { 'zh-TW': '本次', vi: 'Lần này', id: 'Kali ini', th: 'ครั้งนี้', en: 'This time' },
  'history.title': { 'zh-TW': '📊 最近練習紀錄', vi: '📊 Lịch sử luyện tập', id: '📊 Riwayat latihan', th: '📊 ประวัติการฝึก', en: '📊 Practice history' },
  'resume.title': { 'zh-TW': '📂 發現未完成的測驗', vi: '📂 Bài kiểm tra chưa hoàn thành', id: '📂 Ujian belum selesai', th: '📂 พบการสอบที่ยังไม่เสร็จ', en: '📂 Unfinished exam found' },
  'resume.btn': { 'zh-TW': '繼續作答', vi: 'Tiếp tục', id: 'Lanjutkan', th: 'ทำต่อ', en: 'Continue' },
  'resume.discard': { 'zh-TW': '捨棄', vi: 'Hủy bỏ', id: 'Buang', th: 'ลบทิ้ง', en: 'Discard' },
  'resume.discarded': { 'zh-TW': '已捨棄存檔', vi: 'Đã hủy bỏ', id: 'Sudah dihapus', th: 'ลบแล้ว', en: 'Discarded' },
  'resume.restored': { 'zh-TW': '📂 已恢復上次進度', vi: '📂 Đã khôi phục', id: '📂 Dipulihkan', th: '📂 กู้คืนแล้ว', en: '📂 Progress restored' },
  'theme.dark': { 'zh-TW': '切換深色模式', vi: 'Chế độ tối', id: 'Mode Gelap', th: 'โหมดมืด', en: 'Dark Mode' },
  'theme.light': { 'zh-TW': '切換淺色模式', vi: 'Chế độ sáng', id: 'Mode Terang', th: 'โหมดสว่าง', en: 'Light Mode' },
  'error.timeout': { 'zh-TW': '伺服器回應逾時，請稍後再試', vi: 'Máy chủ không phản hồi, thử lại', id: 'Server tidak merespons, coba lagi', th: 'เซิร์ฟเวอร์ไม่ตอบสนอง ลองใหม่', en: 'Server timed out, try again' },
  'error.load': { 'zh-TW': '載入題庫失敗：', vi: 'Tải thất bại:', id: 'Gagal memuat:', th: 'โหลดล้มเหลว:', en: 'Failed to load:' },
  'error.network': { 'zh-TW': '請確認網路連線正常或稍後再試。', vi: 'Kiểm tra kết nối mạng.', id: 'Periksa koneksi internet.', th: 'ตรวจสอบการเชื่อมต่อ', en: 'Check your internet connection.' },
  'error.back': { 'zh-TW': '← 返回首頁', vi: '← Về trang chủ', id: '← Ke beranda', th: '← กลับหน้าแรก', en: '← Back to home' },
  'image.modal.hint': { 'zh-TW': '點擊任意處關閉', vi: 'Nhấn để đóng', id: 'Klik untuk menutup', th: 'คลิกเพื่อปิด', en: 'Click to close' },
  'footer.org': { 'zh-TW': '社團法人中華民國工業安全衛生協會附設台中職業訓練中心', vi: 'Trung tâm Đào tạo Nghề Đài Trung', id: 'Pusat Pelatihan Kejuruan Taichung', th: 'ศูนย์ฝึกอาชีพไถจง', en: 'Taichung Vocational Training Center' },
  'footer.system': { 'zh-TW': '管理職類暨即測即評線上練習系統', vi: 'Hệ thống luyện tập trực tuyến', id: 'Sistem Latihan Online', th: 'ระบบฝึกฝนออนไลน์', en: 'Online Practice System' },
  'pwa.title': { 'zh-TW': '加入主畫面，像 App 一樣使用', vi: 'Thêm vào màn hình chính, dùng như ứng dụng', id: 'Tambahkan ke layar utama, gunakan seperti aplikasi', th: 'เพิ่มไปหน้าจอหลัก ใช้งานเหมือนแอป', en: 'Add to Home Screen, use like an app' },
  'pwa.desc': { 'zh-TW': '安裝到手機桌面，隨時開啟練習，支援離線作答。', vi: 'Cài đặt trên điện thoại, luyện tập mọi lúc, hỗ trợ ngoại tuyến.', id: 'Pasang di ponsel, latihan kapan saja, mendukung offline.', th: 'ติดตั้งบนมือถือ ฝึกได้ทุกเวลา รองรับออฟไลน์', en: 'Install on your phone, practice anytime, works offline.' },
  'pwa.ios': { 'zh-TW': 'Safari 點「分享」→「加入主畫面」', vi: 'Safari nhấn "Chia sẻ" → "Thêm vào MH chính"', id: 'Safari ketuk "Bagikan" → "Tambah ke Layar Utama"', th: 'Safari แตะ "แชร์" → "เพิ่มไปหน้าจอหลัก"', en: 'Safari tap "Share" → "Add to Home Screen"' },
  'pwa.android': { 'zh-TW': 'Chrome 點「⋮ 選單」→「加入主畫面」', vi: 'Chrome nhấn "⋮ Menu" → "Thêm vào MH chính"', id: 'Chrome ketuk "⋮ Menu" → "Tambah ke Layar Utama"', th: 'Chrome แตะ "⋮ เมนู" → "เพิ่มไปหน้าจอหลัก"', en: 'Chrome tap "⋮ Menu" → "Add to Home Screen"' },
  'mode.mock': { 'zh-TW': '模擬考', vi: 'Thi thử', id: 'Simulasi Ujian', th: 'สอบจำลอง', en: 'Mock Exam' },
  'fb.queued': { 'zh-TW': '📦 已暫存，上線後自動送出', vi: '📦 Đã lưu, sẽ gửi khi có mạng', id: '📦 Tersimpan, akan dikirim saat online', th: '📦 บันทึกแล้ว จะส่งเมื่อออนไลน์', en: '📦 Saved, will send when online' },
  'result.ratio.op': { 'zh-TW': '操作科目', vi: 'Môn vận hành', id: 'Mata pelajaran operasi', th: 'วิชาปฏิบัติ', en: 'Operation' },
  'result.ratio.cm': { 'zh-TW': '共同科目', vi: 'Môn chung', id: 'Mata pelajaran umum', th: 'วิชาร่วม', en: 'Common' },
  'group.業務主管': { 'zh-TW': '業務主管', vi: 'Quản lý', id: 'Manajer', th: 'ผู้จัดการ', en: 'Manager' },
  'group.作業主管': { 'zh-TW': '作業主管', vi: 'Giám sát', id: 'Supervisor', th: 'หัวหน้างาน', en: 'Supervisor' },
  'group.職護': { 'zh-TW': '職護', vi: 'Y tá', id: 'Perawat K3', th: 'พยาบาล', en: 'Nurse' },
  'group.即測即評': { 'zh-TW': '即測即評', vi: 'Đánh giá tức thì', id: 'Penilaian Langsung', th: 'ประเมินทันที', en: 'Instant Assessment' },
};

// ===== 核心函式 =====
function getLang() {
  return localStorage.getItem('lang') || 'zh-TW';
}

function setLang(lang) {
  localStorage.setItem('lang', lang);
  applyI18n();
  window.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
}

function t(key, fallback) {
  var lang = getLang();
  var entry = I18N[key];
  if (!entry) return fallback || key;
  return entry[lang] || entry['zh-TW'] || fallback || key;
}

function applyI18n() {
  // 替換 data-i18n 元素
  document.querySelectorAll('[data-i18n]').forEach(function(el) {
    var key = el.getAttribute('data-i18n');
    var text = t(key);
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      el.placeholder = text;
    } else if (el.hasAttribute('title')) {
      el.title = text;
    } else {
      el.textContent = text;
    }
  });

  // 更新語言選擇列 active 狀態
  var lang = getLang();
  document.querySelectorAll('.lang-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });

  document.documentElement.lang = lang === 'zh-TW' ? 'zh-Hant' : lang;
}

// 取得職類後綴（過濾用）
function getLangCatSuffix() {
  return LANG_CAT_SUFFIX[getLang()] || null;
}

// 翻譯職類名稱
function translateCatName(catId, catName) {
  var lang = getLang();
  if (lang === 'zh-TW') return catName;
  for (var zhKey in CAT_NAMES) {
    if (catId.indexOf(zhKey) >= 0 && CAT_NAMES[zhKey][lang]) {
      return CAT_NAMES[zhKey][lang];
    }
  }
  return catName;
}

// 頁面載入時自動套用
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', applyI18n);
} else {
  applyI18n();
}
