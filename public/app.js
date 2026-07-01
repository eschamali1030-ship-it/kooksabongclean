let allClasses = [];
let selectedGrade = null;
let selectedClassNo = null;
let classVerified = false;
let currentMode = null;
let currentUser = "";
let currentDate = new Date();

const gradeSelect = document.getElementById("gradeSelect");
const classSelect = document.getElementById("classSelect");
const accessPasswordInput = document.getElementById("accessPasswordInput");
const verifyClassBtn = document.getElementById("verifyClassBtn");
const modeBox = document.getElementById("modeBox");
const classInfoText = document.getElementById("classInfoText");
const studentSelect = document.getElementById("studentSelect");
const enterReserveBtn = document.getElementById("enterReserveBtn");
const enterViewBtn = document.getElementById("enterViewBtn");

const entrySection = document.getElementById("entrySection");
const appSection = document.getElementById("appSection");
const backBtn = document.getElementById("backBtn");
const monthTitle = document.getElementById("monthTitle");
const calendar = document.getElementById("calendar");
const selectedDateInfo = document.getElementById("selectedDateInfo");
const modeBadge = document.getElementById("modeBadge");
const userInfo = document.getElementById("userInfo");
const todayInfo = document.getElementById("todayInfo");

document.getElementById("prevMonthBtn").addEventListener("click", () => {
  currentDate.setMonth(currentDate.getMonth() - 1);
  renderCalendar();
});

document.getElementById("nextMonthBtn").addEventListener("click", () => {
  currentDate.setMonth(currentDate.getMonth() + 1);
  renderCalendar();
});

backBtn.addEventListener("click", () => {
  appSection.classList.add("hidden");
  entrySection.classList.remove("hidden");
  selectedDateInfo.innerHTML = "날짜를 선택하세요.";
});

gradeSelect.addEventListener("change", () => {
  renderClassOptions();
  clearClassVerification();
});

classSelect.addEventListener("change", () => {
  clearClassVerification();
});

verifyClassBtn.addEventListener("click", async () => {
  selectedGrade = Number(gradeSelect.value);
  selectedClassNo = Number(classSelect.value);
  const password = accessPasswordInput.value;

  if (!selectedGrade || !selectedClassNo) {
    alert("학년과 반을 먼저 선택해주세요.");
    return;
  }

  const res = await fetch("/api/class/access", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grade: selectedGrade,
      classNo: selectedClassNo,
      password
    })
  });

  const data = await res.json();

  if (!res.ok) {
    alert(data.message || "반 접속 실패");
    return;
  }

  classVerified = true;
  classInfoText.textContent = `${selectedGrade}학년 ${selectedClassNo}반 접속 확인 완료`;
  modeBox.classList.remove("hidden");

  await loadStudents();
  await loadTodayInfo();
});

enterReserveBtn.addEventListener("click", () => {
  currentUser = studentSelect.value;

  if (!classVerified) {
    alert("먼저 반 접속 확인을 해주세요.");
    return;
  }

  if (!currentUser) {
    alert("학생을 선택해주세요.");
    return;
  }

  currentMode = "reserve";
  startApp();
});

enterViewBtn.addEventListener("click", () => {
  if (!classVerified) {
    alert("먼저 반 접속 확인을 해주세요.");
    return;
  }

  currentMode = "view";
  currentUser = "";
  startApp();
});

function clearClassVerification() {
  classVerified = false;
  modeBox.classList.add("hidden");
  studentSelect.innerHTML = `<option value="">학생 선택</option>`;
  classInfoText.textContent = "";
  todayInfo.textContent = "반을 선택하면 오늘 청소 담당이 표시됩니다.";
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function loadClasses() {
  const res = await fetch("/api/classes");
  const data = await res.json();

  allClasses = data.classes || [];

  const grades = [...new Set(allClasses.map(item => item.grade))].sort((a, b) => a - b);

  gradeSelect.innerHTML =
    `<option value="">학년 선택</option>` +
    grades.map(grade => `<option value="${grade}">${grade}학년</option>`).join("");

  classSelect.innerHTML = `<option value="">반 선택</option>`;
}

function renderClassOptions() {
  const grade = Number(gradeSelect.value);

  if (!grade) {
    classSelect.innerHTML = `<option value="">반 선택</option>`;
    return;
  }

  const classes = allClasses
    .filter(item => item.grade === grade)
    .map(item => item.class_no)
    .sort((a, b) => a - b);

  classSelect.innerHTML =
    `<option value="">반 선택</option>` +
    classes.map(classNo => `<option value="${classNo}">${classNo}반</option>`).join("");
}

async function loadStudents() {
  const res = await fetch(`/api/students?grade=${selectedGrade}&classNo=${selectedClassNo}`);
  const data = await res.json();

  studentSelect.innerHTML =
    `<option value="">학생 선택</option>` +
    (data.students || []).map(name => `<option value="${name}">${name}</option>`).join("");
}

async function loadTodayInfo() {
  if (!selectedGrade || !selectedClassNo) return;

  const res = await fetch(`/api/today?grade=${selectedGrade}&classNo=${selectedClassNo}`);
  const data = await res.json();

  if (!res.ok) {
    todayInfo.textContent = "오늘 청소 담당 정보를 불러오지 못했습니다.";
    return;
  }

  if (data.blocked) {
    if (data.holidayName) {
      todayInfo.textContent = `오늘(${data.date})은 ${data.holidayName}로 청소 없음`;
    } else {
      todayInfo.textContent = `오늘(${data.date})은 주말로 청소 없음`;
    }
    return;
  }

  todayInfo.textContent = data.cleaners.length
    ? `오늘(${data.date}) ${selectedGrade}학년 ${selectedClassNo}반 청소 담당: ${data.cleaners.join(", ")}`
    : `오늘(${data.date}) ${selectedGrade}학년 ${selectedClassNo}반 청소 담당자가 아직 없습니다.`;
}

function startApp() {
  entrySection.classList.add("hidden");
  appSection.classList.remove("hidden");

  if (currentMode === "reserve") {
    modeBadge.textContent = "예약 모드";
    userInfo.textContent = `${selectedGrade}학년 ${selectedClassNo}반 / ${currentUser}`;
  } else {
    modeBadge.textContent = "조회 모드";
    userInfo.textContent = `${selectedGrade}학년 ${selectedClassNo}반 조회 중`;
  }

  renderCalendar();
}

async function renderCalendar() {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;

  monthTitle.textContent = `${year}년 ${month}월`;

  const res = await fetch(`/api/reservations?grade=${selectedGrade}&classNo=${selectedClassNo}&year=${year}&month=${month}`);
  const data = await res.json();

  const reservations = data.reservations || {};
  const holidays = data.holidays || {};

  calendar.innerHTML = "";

  const days = ["일", "월", "화", "수", "목", "금", "토"];
  days.forEach(day => {
    const header = document.createElement("div");
    header.className = "day-header";
    header.textContent = day;
    calendar.appendChild(header);
  });

  const firstDay = new Date(year, month - 1, 1);
  const lastDate = new Date(year, month, 0).getDate();
  const startDay = firstDay.getDay();

  for (let i = 0; i < startDay; i++) {
    const empty = document.createElement("div");
    empty.className = "day-cell empty-cell";
    calendar.appendChild(empty);
  }

  for (let day = 1; day <= lastDate; day++) {
    const dateObj = new Date(year, month - 1, day);
    const dateStr = formatDate(dateObj);
    const dayOfWeek = dateObj.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isHoliday = Boolean(holidays[dateStr]);

    const names = reservations[dateStr] || [];
    const cell = document.createElement("div");
    cell.classList.add("day-cell");

    let statusText = "";

    if (isWeekend || isHoliday) {
      cell.classList.add("holiday-cell");
      statusText = isHoliday ? holidays[dateStr] : "주말";
    } else if (names.length >= 2) {
      cell.classList.add("full-cell");
      statusText = `마감 (${names.length}/2)`;
    } else if (names.length === 1) {
      cell.classList.add("partial-cell");
      statusText = "1명 예약";
    } else {
      cell.classList.add("available-cell");
      statusText = "예약 가능";
    }

    cell.innerHTML = `
      <div class="day-number">${day}</div>
      <div class="day-status">${statusText}</div>
    `;

    cell.addEventListener("click", () => {
      showDateDetails(dateStr, names, isWeekend, isHoliday, holidays[dateStr] || null);
    });

    calendar.appendChild(cell);
  }
}

function showDateDetails(dateStr, names, isWeekend, isHoliday, holidayName) {
  let html = `<p><strong>날짜:</strong> ${dateStr}</p>`;

  if (isWeekend || isHoliday) {
    html += `<p>선택 불가 날짜입니다. (${holidayName || "주말"})</p>`;
    selectedDateInfo.innerHTML = html;
    return;
  }

  html += `<p><strong>예약자:</strong> ${names.length ? names.join(", ") : "없음"}</p>`;
  html += `<p><strong>현재 상태:</strong> ${names.length}/2명 예약</p>`;

  if (currentMode === "reserve") {
    const alreadyReserved = names.includes(currentUser);
    const isFull = names.length >= 2;

    if (alreadyReserved) {
      html += `<p>이미 이 날짜를 예약했습니다. 예약 취소는 관리자만 가능합니다.</p>`;
    } else if (!isFull) {
      html += `<button class="primary-btn" onclick="makeReservation('${dateStr}')">이 날짜 예약하기</button>`;
    } else {
      html += `<p>이 날짜는 이미 마감되었습니다.</p>`;
    }
  } else {
    html += `<p>조회 모드입니다.</p>`;
  }

  selectedDateInfo.innerHTML = html;
}

async function makeReservation(dateStr) {
  const res = await fetch("/api/reserve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grade: selectedGrade,
      classNo: selectedClassNo,
      name: currentUser,
      date: dateStr
    })
  });

  const data = await res.json();

  if (!res.ok) {
    alert(data.message || "예약 실패");
    return;
  }

  alert(data.message);
  await renderCalendar();
  await loadTodayInfo();
  selectedDateInfo.innerHTML = `<p>${dateStr} 예약 완료</p>`;
}

loadClasses();
