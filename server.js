const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const DATA_DIR = path.join(__dirname, "data");
const RESERVATIONS_FILE = path.join(DATA_DIR, "reservations.json");
const STUDENTS_FILE = path.join(DATA_DIR, "students.json");

const ADMIN_PASSWORD = "1030"; // 필요하면 변경

function ensureFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

  if (!fs.existsSync(RESERVATIONS_FILE)) {
    fs.writeFileSync(RESERVATIONS_FILE, JSON.stringify({}, null, 2), "utf8");
  }

  if (!fs.existsSync(STUDENTS_FILE)) {
    fs.writeFileSync(
      STUDENTS_FILE,
      JSON.stringify([
        "A","B","C","D","E","F","G","H","I","J","K","L","M",
        "N","O","P","Q","R","S","T","U","V","W","X","Y","Z"
      ], null, 2),
      "utf8"
    );
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

ensureFiles();

function getReservations() {
  return readJson(RESERVATIONS_FILE);
}

function saveReservations(data) {
  writeJson(RESERVATIONS_FILE, data);
}

function getStudents() {
  return readJson(STUDENTS_FILE);
}

/**
 * 실제 운영 시 공휴일 API 연동 가능
 * 지금은 예시용 + 구조 포함
 */
async function getHolidayMap(year) {
  return {
    [`${year}-01-01`]: "신정",
    [`${year}-03-01`]: "삼일절",
    [`${year}-05-05`]: "어린이날",
    [`${year}-06-06`]: "현충일",
    [`${year}-08-15`]: "광복절",
    [`${year}-10-03`]: "개천절",
    [`${year}-10-09`]: "한글날",
    [`${year}-12-25`]: "성탄절"
  };
}

function isWeekend(dateStr) {
  const date = new Date(dateStr);
  const day = date.getDay();
  return day === 0 || day === 6;
}

async function isHoliday(dateStr) {
  const year = Number(dateStr.slice(0, 4));
  const holidayMap = await getHolidayMap(year);
  return Boolean(holidayMap[dateStr]);
}

async function getHolidayName(dateStr) {
  const year = Number(dateStr.slice(0, 4));
  const holidayMap = await getHolidayMap(year);
  return holidayMap[dateStr] || null;
}

async function isBlockedDate(dateStr) {
  return isWeekend(dateStr) || await isHoliday(dateStr);
}

function getTodayStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

app.get("/api/students", (req, res) => {
  res.json({ students: getStudents() });
});

app.get("/api/reservations", async (req, res) => {
  const year = Number(req.query.year);
  const month = Number(req.query.month);

  if (!year || !month) {
    return res.status(400).json({ message: "year와 month가 필요합니다." });
  }

  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  const allReservations = getReservations();
  const result = {};

  for (const date in allReservations) {
    if (date.startsWith(prefix)) {
      result[date] = allReservations[date];
    }
  }

  const holidayMap = await getHolidayMap(year);
  const monthHolidays = {};
  for (const date in holidayMap) {
    if (date.startsWith(prefix)) {
      monthHolidays[date] = holidayMap[date];
    }
  }

  res.json({
    reservations: result,
    holidays: monthHolidays
  });
});

app.get("/api/today", async (req, res) => {
  const today = getTodayStr();
  const reservations = getReservations();
  const holidayName = await getHolidayName(today);

  res.json({
    date: today,
    cleaners: reservations[today] || [],
    blocked: isWeekend(today) || Boolean(holidayName),
    holidayName
  });
});

app.post("/api/reserve", async (req, res) => {
  const { name, date } = req.body;
  const students = getStudents();

  if (!name || !date) {
    return res.status(400).json({ message: "name과 date가 필요합니다." });
  }

  if (!students.includes(name)) {
    return res.status(400).json({ message: "등록된 학생만 예약할 수 있습니다." });
  }

  if (await isBlockedDate(date)) {
    return res.status(400).json({ message: "공휴일 또는 주말은 예약할 수 없습니다." });
  }

  const reservations = getReservations();

  if (!reservations[date]) {
    reservations[date] = [];
  }

  if (reservations[date].includes(name)) {
    return res.status(400).json({ message: "이미 해당 날짜를 예약했습니다." });
  }

  if (reservations[date].length >= 2) {
    return res.status(400).json({ message: "해당 날짜는 이미 2명이 예약했습니다." });
  }

  reservations[date].push(name);
  saveReservations(reservations);

  res.json({
    message: "예약이 완료되었습니다.",
    date,
    cleaners: reservations[date]
  });
});

app.post("/api/cancel", (req, res) => {
  return res.status(403).json({ message: "학생 예약 취소는 불가능합니다. 관리자만 취소할 수 있습니다." });
});

app.post("/api/admin/login", (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ message: "비밀번호가 올바르지 않습니다." });
  }
  res.json({ message: "로그인 성공" });
});

app.get("/api/admin/all", (req, res) => {
  res.json({ reservations: getReservations() });
});

app.post("/api/admin/delete", (req, res) => {
  const { password, date, name } = req.body;

  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ message: "관리자 인증 실패" });
  }

  const reservations = getReservations();

  if (!reservations[date]) {
    return res.status(404).json({ message: "해당 날짜 예약이 없습니다." });
  }

  if (name) {
    reservations[date] = reservations[date].filter((n) => n !== name);
    if (reservations[date].length === 0) {
      delete reservations[date];
    }
  } else {
    delete reservations[date];
  }

  saveReservations(reservations);
  res.json({ message: "삭제 완료" });
});

app.post("/api/admin/reset", (req, res) => {
  const { password } = req.body;

  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ message: "관리자 인증 실패" });
  }

  saveReservations({});
  res.json({ message: "전체 초기화 완료" });
});

app.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
});

app.get("/api/admin/export-csv", async (req, res) => {
  const year = Number(req.query.year);
  const month = Number(req.query.month);

  if (!year || !month) {
    return res.status(400).send("year와 month가 필요합니다.");
  }

  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  const reservations = getReservations();

  let csv = "날짜,예약자1,예약자2\n";

  const lastDate = new Date(year, month, 0).getDate();

  for (let day = 1; day <= lastDate; day++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const names = reservations[dateStr] || [];
    const name1 = names[0] || "";
    const name2 = names[1] || "";
    csv += `${dateStr},${name1},${name2}\n`;
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="reservations-${year}-${String(month).padStart(2, "0")}.csv"`);
  res.send("\uFEFF" + csv);
});
