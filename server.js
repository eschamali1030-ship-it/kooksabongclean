const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/**
 * 관리자 비밀번호
 * 원하는 비밀번호로 바꾸세요.
 */
const ADMIN_PASSWORD = "1030";

/**
 * 기본 학생 목록
 * 여기 이름을 원하는 대로 바꾸면 됩니다.
 */
const DEFAULT_STUDENTS = [
  "강하엘",
  "고은정",
  "권동익",
  "김동률",
  "김선중",
  "김승유",
  "남주원",
  "박건후",
  "박선호",
  "박세현",
  "빅장현",
  "박지이",
  "방소윤",
  "송연수",
  "신은채",
  "염하늘",
  "윤지우",
  "이건호",
  "이서윤",
  "이윤아",
  "이준서",
  "장예림",
  "최민준",
  "최진욱",
  "한예현"
];

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL이 설정되지 않았습니다.");
  console.error("Render 웹서비스의 Environment에 DATABASE_URL을 넣어주세요.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reservations (
      id SERIAL PRIMARY KEY,
      date VARCHAR(10) NOT NULL,
      name VARCHAR(100) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(date, name)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS students (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL UNIQUE
    );
  `);

  const result = await pool.query(`SELECT COUNT(*)::int AS count FROM students`);
  if (result.rows[0].count === 0) {
    for (const student of DEFAULT_STUDENTS) {
      await pool.query(
        `INSERT INTO students (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
        [student]
      );
    }
  }
}

async function getStudents() {
  const result = await pool.query(`SELECT name FROM students ORDER BY name ASC`);
  return result.rows.map(row => row.name);
}

async function getHolidayMap(year) {
  const SERVICE_KEY = process.env.HOLIDAY_API_KEY || "";

  if (!SERVICE_KEY) {
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

  const url = `https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo?serviceKey=${SERVICE_KEY}&solYear=${year}&numOfRows=100&_type=json`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    const items = data?.response?.body?.items?.item;
    const holidayMap = {};

    if (!items) return holidayMap;

    const itemArray = Array.isArray(items) ? items : [items];

    itemArray.forEach(item => {
      const raw = String(item.locdate);
      const y = raw.slice(0, 4);
      const m = raw.slice(4, 6);
      const d = raw.slice(6, 8);
      holidayMap[`${y}-${m}-${d}`] = item.dateName;
    });

    return holidayMap;
  } catch (error) {
    console.error("공휴일 API 오류:", error);
    return {};
  }
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

app.get("/api/students", async (req, res) => {
  try {
    const students = await getStudents();
    res.json({ students });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "학생 목록 조회 실패" });
  }
});

app.get("/api/reservations", async (req, res) => {
  try {
    const year = Number(req.query.year);
    const month = Number(req.query.month);

    if (!year || !month) {
      return res.status(400).json({ message: "year와 month가 필요합니다." });
    }

    const prefix = `${year}-${String(month).padStart(2, "0")}`;

    const result = await pool.query(
      `SELECT date, name FROM reservations WHERE date LIKE $1 ORDER BY date ASC, name ASC`,
      [`${prefix}%`]
    );

    const reservations = {};
    for (const row of result.rows) {
      if (!reservations[row.date]) {
        reservations[row.date] = [];
      }
      reservations[row.date].push(row.name);
    }

    const holidayMap = await getHolidayMap(year);
    const monthHolidays = {};
    for (const date in holidayMap) {
      if (date.startsWith(prefix)) {
        monthHolidays[date] = holidayMap[date];
      }
    }

    res.json({
      reservations,
      holidays: monthHolidays
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "예약 조회 실패" });
  }
});

app.get("/api/today", async (req, res) => {
  try {
    const today = getTodayStr();

    const result = await pool.query(
      `SELECT name FROM reservations WHERE date = $1 ORDER BY name ASC`,
      [today]
    );

    const cleaners = result.rows.map(row => row.name);
    const holidayName = await getHolidayName(today);

    res.json({
      date: today,
      cleaners,
      blocked: isWeekend(today) || Boolean(holidayName),
      holidayName
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "오늘 정보 조회 실패" });
  }
});

app.post("/api/reserve", async (req, res) => {
  try {
    const { name, date } = req.body;

    if (!name || !date) {
      return res.status(400).json({ message: "name과 date가 필요합니다." });
    }

    const students = await getStudents();
    if (!students.includes(name)) {
      return res.status(400).json({ message: "등록된 학생만 예약할 수 있습니다." });
    }

    if (await isBlockedDate(date)) {
      return res.status(400).json({ message: "공휴일 또는 주말은 예약할 수 없습니다." });
    }

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS count FROM reservations WHERE date = $1`,
      [date]
    );

    if (countResult.rows[0].count >= 2) {
      return res.status(400).json({ message: "해당 날짜는 이미 2명이 예약했습니다." });
    }

    try {
      await pool.query(
        `INSERT INTO reservations (date, name) VALUES ($1, $2)`,
        [date, name]
      );
    } catch (insertError) {
      if (insertError.code === "23505") {
        return res.status(400).json({ message: "이미 해당 날짜를 예약했습니다." });
      }
      throw insertError;
    }

    const result = await pool.query(
      `SELECT name FROM reservations WHERE date = $1 ORDER BY name ASC`,
      [date]
    );

    res.json({
      message: "예약이 완료되었습니다.",
      date,
      cleaners: result.rows.map(row => row.name)
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "예약 실패" });
  }
});

app.post("/api/cancel", (req, res) => {
  return res.status(403).json({
    message: "학생 예약 취소는 불가능합니다. 관리자만 취소할 수 있습니다."
  });
});

app.post("/api/admin/login", (req, res) => {
  const { password } = req.body;

  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ message: "비밀번호가 올바르지 않습니다." });
  }

  res.json({ message: "로그인 성공" });
});

app.get("/api/admin/all", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT date, name FROM reservations ORDER BY date ASC, name ASC`
    );

    const reservations = {};
    for (const row of result.rows) {
      if (!reservations[row.date]) {
        reservations[row.date] = [];
      }
      reservations[row.date].push(row.name);
    }

    res.json({ reservations });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "관리자 예약 조회 실패" });
  }
});

app.post("/api/admin/delete", async (req, res) => {
  try {
    const { password, date, name } = req.body;

    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ message: "관리자 인증 실패" });
    }

    if (!date) {
      return res.status(400).json({ message: "date가 필요합니다." });
    }

    if (name) {
      await pool.query(
        `DELETE FROM reservations WHERE date = $1 AND name = $2`,
        [date, name]
      );
    } else {
      await pool.query(
        `DELETE FROM reservations WHERE date = $1`,
        [date]
      );
    }

    res.json({ message: "삭제 완료" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "삭제 실패" });
  }
});

app.post("/api/admin/reset", async (req, res) => {
  try {
    const { password } = req.body;

    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ message: "관리자 인증 실패" });
    }

    await pool.query(`DELETE FROM reservations`);

    res.json({ message: "전체 예약 초기화 완료" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "초기화 실패" });
  }
});

app.post("/api/admin/reset-students", async (req, res) => {
  try {
    const { password } = req.body;

    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ message: "관리자 인증 실패" });
    }

    await pool.query(`DELETE FROM students`);

    for (const student of DEFAULT_STUDENTS) {
      await pool.query(
        `INSERT INTO students (name) VALUES ($1)`,
        [student]
      );
    }

    res.json({ message: "학생 목록이 새 이름으로 초기화되었습니다." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "학생 목록 초기화 실패" });
  }
});

app.get("/api/admin/export-csv", async (req, res) => {
  try {
    const year = Number(req.query.year);
    const month = Number(req.query.month);

    if (!year || !month) {
      return res.status(400).send("year와 month가 필요합니다.");
    }

    const prefix = `${year}-${String(month).padStart(2, "0")}`;

    const result = await pool.query(
      `SELECT date, name FROM reservations WHERE date LIKE $1 ORDER BY date ASC, name ASC`,
      [`${prefix}%`]
    );

    const reservationMap = {};
    for (const row of result.rows) {
      if (!reservationMap[row.date]) {
        reservationMap[row.date] = [];
      }
      reservationMap[row.date].push(row.name);
    }

    let csv = "날짜,예약자1,예약자2\n";
    const lastDate = new Date(year, month, 0).getDate();

for (let day = 1; day <= lastDate; day++) {
  const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const names = reservationMap[dateStr] || [];
  const name1 = names[0] || "";
  const name2 = names[1] || "";
  const excelDate = `${year}.${String(month).padStart(2, "0")}.${String(day).padStart(2, "0")}.`;

  csv += `="${excelDate}",${name1},${name2}\n`;
}

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="reservations-${year}-${String(month).padStart(2, "0")}.csv"`);
    res.send("\uFEFF" + csv);
  } catch (error) {
    console.error(error);
    res.status(500).send("CSV 다운로드 실패");
  }
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`서버 실행 중: http://localhost:${PORT}`);
    });
  })
  .catch(error => {
    console.error("DB 초기화 실패:", error);
    process.exit(1);
  });
