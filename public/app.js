let currentDate = new Date();
let currentMode = null;
let currentUser = "";

const entrySection = document.getElementById("entrySection");
const appSection = document.getElementById("appSection");
const studentSelect = document.getElementById("studentSelect");
const enterReserveBtn = document.getElementById("enterReserveBtn");
const enterViewBtn = document.getElementById("enterViewBtn");
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

enterReserveBtn.addEventListener("click", () => {
  currentUser = studentSelect.value;
  if (!currentUser) {
    alert("학생을 선택해주세요.");
    return;
  }

  currentMode = "reserve";
  startApp();
});

enterViewBtn.addEventListener("click", () => {
  currentMode = "view";
  currentUser = "";
  startApp();
});

backBtn.addEventListener("click", () => {
  entrySection.classList.remove("hidden");
  appSection.classList.add("hidden");
  selectedDateInfo.innerHTML = "날짜를 선택하세요.";
});

function startApp() {
  entrySection.classList.add("hidden");
  appSection.classList.remove("hidden");

  if (currentMode === "reserve") {
    modeBadge.textContent = "예약 모드";
    userInfo.textContent = `${currentUser}님으로 접속 중`;
  } else {
    modeBadge.textContent = "조회 모드";
    userInfo.textContent = "예약 현황 조회 중";
  }

  renderCalendar();
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function loadStudents() {
  const res = await fetch("/api/students");
  const data = await res.json();

  studentSelect.innerHTML = `<option value="">학생 선택</option>` +
    data.students.map(s => `<option value="${s}">${s}</option>`).join("");
}

async function loadTodayInfo() {
  const res = await fetch("/api/today");
  const data = await res.json();

  if (data.blocked) {
    todayInfo.textContent = data.holidayName
      ? `오늘(${data.date})은 ${data.holidayName}로 청소 없음`
      : `오늘(${data.date})은 주말로 청소 없음`;
    return;
  }

  todayInfo.textContent = data.cleaners.length
    ? `오늘(${data.date}) 청소 담당: ${data.cleaners.join(", ")}`
    : `오늘(${data.date}) 청소 담당자가 아직 없습니다.`;
}

async function renderCalendar() {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;

  monthTitle.textContent = `${year}년 ${month}월`;

  const res = await fetch(`/api/reservations?year=${year}&month=${month}`);
  const data = await res.json();

  const reservations = data.reservations;
  const holidays = data.holidays;

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
    body: JSON.stringify({ name: currentUser, date: dateStr })
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

loadStudents();
loadTodayInfo();
