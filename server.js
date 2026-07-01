const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const SUPER_ADMIN_PASSWORD = "shrudals10!%!=!";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL이 설정되지 않았습니다.");
  console.error("Render 웹서비스의 Environment에 DATABASE_URL을 넣어주세요.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function getTodayStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isWeekend(dateStr) {
  const date = new Date(dateStr);
  const day = date.getDay();
  return day === 0 || day === 6;
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

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS classes (
      id SERIAL PRIMARY KEY,
      grade INTEGER NOT NULL,
      class_no INTEGER NOT NULL,
      access_password VARCHAR(100) DEFAULT '',
      sub_admin_password VARCHAR(100) DEFAULT '0000',
      UNIQUE(grade, class_no)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS students (
      id SERIAL PRIMARY KEY,
      class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      name VARCHAR(100) NOT NULL,
      UNIQUE(class_id, name)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reservations (
      id SERIAL PRIMARY KEY,
      class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      date VARCHAR(10) NOT NULL,
      name VARCHAR(100) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(class_id, date, name)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_assignments (
      id SERIAL PRIMARY KEY,
      class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      date VARCHAR(10) NOT NULL,
      name VARCHAR(100) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(class_id, date, name)
    );
  `);
}

async function getClassByGradeAndNo(grade, classNo) {
  const result = await pool.query(
    `SELECT * FROM classes WHERE grade = $1 AND class_no = $2`,
    [grade, classNo]
  );
  return result.rows[0] || null;
}

async function getClasses() {
  const result = await pool.query(
    `SELECT grade, class_no FROM classes ORDER BY grade ASC, class_no ASC`
  );
  return result.rows;
}

async function getStudentsByClassId(classId) {
  const result = await pool.query(
    `SELECT name FROM students WHERE class_id = $1 ORDER BY name ASC`,
    [classId]
  );
  return result.rows.map(row => row.name);
}

async function mergeTodayCleaners(classId, date) {
  const reservedResult = await pool.query(
    `SELECT name FROM reservations WHERE class_id = $1 AND date = $2 ORDER BY name ASC`,
    [classId, date]
  );

  const assignedResult = await pool.query(
    `SELECT name FROM admin_assignments WHERE class_id = $1 AND date = $2 ORDER BY name ASC`,
    [classId, date]
  );

  const reserved = reservedResult.rows.map(row => row.name);
  const assigned = assignedResult.rows.map(row => row.name);

  return [...new Set([...assigned, ...reserved])];
}

/**
 * 통합 관리자 로그인
 */
app.post("/api/superadmin/login", (req, res) => {
  const { password } = req.body;

  if (password !== SUPER_ADMIN_PASSWORD) {
    return res.status(401).json({ message: "통합 관리자 비밀번호가 올바르지 않습니다." });
  }

  res.json({ message: "통합 관리자 로그인 성공" });
});

/**
 * 학년별 학급 구조 생성/정리
 * classCount1, classCount2, classCount3 사용
 * 예: 1학년 5반, 2학년 5반, 3학년 4반
 */
app.post("/api/superadmin/setup-classes", async (req, res) => {
  try {
    const { password, classCount1, classCount2, classCount3 } = req.body;

    if (password !== SUPER_ADMIN_PASSWORD) {
      return res.status(401).json({ message: "통합 관리자 인증 실패" });
    }

    const counts = {
      1: Number(classCount1) || 0,
      2: Number(classCount2) || 0,
      3: Number(classCount3) || 0
    };

    if (counts[1] < 0 || counts[2] < 0 || counts[3] < 0) {
      return res.status(400).json({ message: "반 수를 올바르게 입력해주세요." });
    }

    const wanted = [];
    for (const grade of [1, 2, 3]) {
      for (let classNo = 1; classNo <= counts[grade]; classNo++) {
        wanted.push({ grade, classNo });
      }
    }

    const currentResult = await pool.query(
      `SELECT id, grade, class_no FROM classes ORDER BY grade ASC, class_no ASC`
    );
    const currentClasses = currentResult.rows;

    // 필요 없는 반 삭제
    for (const cls of currentClasses) {
      const stillNeeded = wanted.some(
        item => item.grade === cls.grade && item.classNo === cls.class_no
      );

      if (!stillNeeded) {
        await pool.query(`DELETE FROM classes WHERE id = $1`, [cls.id]);
      }
    }

    // 필요한 반 추가
    for (const item of wanted) {
      await pool.query(
        `
        INSERT INTO classes (grade, class_no, sub_admin_password)
        VALUES ($1, $2, $3)
        ON CONFLICT (grade, class_no)
        DO NOTHING
        `,
        [item.grade, item.classNo, "0000"]
      );
    }

    res.json({ message: "학년별 학급 구조 생성 완료" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "학급 구조 생성 실패" });
  }
});

/**
 * 통합 관리자: 전체 반 목록 조회
 */
app.get("/api/superadmin/classes", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, grade, class_no, access_password, sub_admin_password
       FROM classes
       ORDER BY grade ASC, class_no ASC`
    );

    res.json({ classes: result.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "학급 목록 조회 실패" });
  }
});

/**
 * 통합 관리자: 특정 반 서브 관리자 비밀번호 설정
 */
app.post("/api/superadmin/set-subadmin-password", async (req, res) => {
  try {
    const { password, grade, classNo, subAdminPassword } = req.body;

    if (password !== SUPER_ADMIN_PASSWORD) {
      return res.status(401).json({ message: "통합 관리자 인증 실패" });
    }

    const targetClass = await getClassByGradeAndNo(Number(grade), Number(classNo));
    if (!targetClass) {
      return res.status(404).json({ message: "해당 반을 찾을 수 없습니다." });
    }

    await pool.query(
      `UPDATE classes SET sub_admin_password = $1 WHERE id = $2`,
      [subAdminPassword || "0000", targetClass.id]
    );

    res.json({ message: "서브 관리자 비밀번호 설정 완료" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "서브 관리자 비밀번호 설정 실패" });
  }
});

/**
 * 통합 관리자: 모든 반 서브 관리자 비밀번호 0000으로 초기화
 */
app.post("/api/superadmin/reset-all-subadmin-passwords", async (req, res) => {
  try {
    const { password } = req.body;

    if (password !== SUPER_ADMIN_PASSWORD) {
      return res.status(401).json({ message: "통합 관리자 인증 실패" });
    }

    await pool.query(`UPDATE classes SET sub_admin_password = '0000'`);

    res.json({ message: "모든 반의 서브 관리자 비밀번호를 0000으로 초기화했습니다." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "서브 관리자 비밀번호 일괄 초기화 실패" });
  }
});

/**
 * 통합 관리자: 연간 CSV 다운로드
 */
app.get("/api/superadmin/export-year-csv", async (req, res) => {
  try {
    const reservationsResult = await pool.query(`
      SELECT c.grade, c.class_no, r.date, r.name, '예약' AS type
      FROM reservations r
      JOIN classes c ON r.class_id = c.id
      ORDER BY r.date ASC, c.grade ASC, c.class_no ASC, r.name ASC
    `);

    const assignmentsResult = await pool.query(`
      SELECT c.grade, c.class_no, a.date, a.name, '관리자배정' AS type
      FROM admin_assignments a
      JOIN classes c ON a.class_id = c.id
      ORDER BY a.date ASC, c.grade ASC, c.class_no ASC, a.name ASC
    `);

    const rows = [...reservationsResult.rows, ...assignmentsResult.rows]
      .sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        if (a.grade !== b.grade) return a.grade - b.grade;
        if (a.class_no !== b.class_no) return a.class_no - b.class_no;
        return a.name.localeCompare(b.name);
      });

    let csv = "구분,날짜,학년,반,이름\n";

    for (const row of rows) {
      const excelDate = row.date.replace(/-/g, ".");
      csv += `${row.type},="${excelDate}.",${row.grade},${row.class_no},${row.name}\n`;
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="year-records.csv"`);
    res.send("\uFEFF" + csv);
  } catch (error) {
    console.error(error);
    res.status(500).send("연간 CSV 다운로드 실패");
  }
});

/**
 * 통합 관리자: 예약/배정 전체 초기화
 */
app.post("/api/superadmin/reset-year-data", async (req, res) => {
  try {
    const { password } = req.body;

    if (password !== SUPER_ADMIN_PASSWORD) {
      return res.status(401).json({ message: "통합 관리자 인증 실패" });
    }

    await pool.query(`DELETE FROM reservations`);
    await pool.query(`DELETE FROM admin_assignments`);

    res.json({ message: "예약 및 관리자 배정 기록 전체 초기화 완료" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "연간 데이터 초기화 실패" });
  }
});

/**
 * 학생/조회자용: 반 목록
 */
app.get("/api/classes", async (req, res) => {
  try {
    const classes = await getClasses();
    res.json({ classes });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "학급 목록 조회 실패" });
  }
});

/**
 * 학생/조회자용: 반 접속 인증
 */
app.post("/api/class/access", async (req, res) => {
  try {
    const { grade, classNo, password } = req.body;

    const targetClass = await getClassByGradeAndNo(Number(grade), Number(classNo));
    if (!targetClass) {
      return res.status(404).json({ message: "해당 반이 없습니다." });
    }

    if ((targetClass.access_password || "") !== (password || "")) {
      return res.status(401).json({ message: "반 접속 비밀번호가 올바르지 않습니다." });
    }

    res.json({
      message: "반 접속 성공",
      classId: targetClass.id,
      grade: targetClass.grade,
      classNo: targetClass.class_no
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "반 접속 처리 실패" });
  }
});

/**
 * 학생 목록 가져오기
 */
app.get("/api/students", async (req, res) => {
  try {
    const grade = Number(req.query.grade);
    const classNo = Number(req.query.classNo);

    const targetClass = await getClassByGradeAndNo(grade, classNo);
    if (!targetClass) {
      return res.status(404).json({ message: "해당 반이 없습니다." });
    }

    const students = await getStudentsByClassId(targetClass.id);
    res.json({ students });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "학생 목록 조회 실패" });
  }
});

/**
 * 월별 예약 조회
 */
app.get("/api/reservations", async (req, res) => {
  try {
    const grade = Number(req.query.grade);
    const classNo = Number(req.query.classNo);
    const year = Number(req.query.year);
    const month = Number(req.query.month);

    const targetClass = await getClassByGradeAndNo(grade, classNo);
    if (!targetClass) {
      return res.status(404).json({ message: "해당 반이 없습니다." });
    }

    const prefix = `${year}-${String(month).padStart(2, "0")}`;

    const result = await pool.query(
      `SELECT date, name FROM reservations
       WHERE class_id = $1 AND date LIKE $2
       ORDER BY date ASC, name ASC`,
      [targetClass.id, `${prefix}%`]
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

/**
 * 오늘 청소 담당
 */
app.get("/api/today", async (req, res) => {
  try {
    const grade = Number(req.query.grade);
    const classNo = Number(req.query.classNo);

    const targetClass = await getClassByGradeAndNo(grade, classNo);
    if (!targetClass) {
      return res.status(404).json({ message: "해당 반이 없습니다." });
    }

    const today = getTodayStr();
    const holidayName = await getHolidayName(today);
    const blocked = isWeekend(today) || Boolean(holidayName);

    if (blocked) {
      return res.json({
        date: today,
        cleaners: [],
        blocked: true,
        holidayName
      });
    }

    const cleaners = await mergeTodayCleaners(targetClass.id, today);

    res.json({
      date: today,
      cleaners,
      blocked: false,
      holidayName: null
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "오늘 정보 조회 실패" });
  }
});

/**
 * 학생 예약
 */
app.post("/api/reserve", async (req, res) => {
  try {
    const { grade, classNo, name, date } = req.body;

    if (!grade || !classNo || !name || !date) {
      return res.status(400).json({ message: "grade, classNo, name, date가 필요합니다." });
    }

    const targetClass = await getClassByGradeAndNo(Number(grade), Number(classNo));
    if (!targetClass) {
      return res.status(404).json({ message: "해당 반이 없습니다." });
    }

    const students = await getStudentsByClassId(targetClass.id);
    if (!students.includes(name)) {
      return res.status(400).json({ message: "해당 반에 등록된 학생만 예약할 수 있습니다." });
    }

    if (await isBlockedDate(date)) {
      return res.status(400).json({ message: "공휴일 또는 주말은 예약할 수 없습니다." });
    }

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS count FROM reservations
       WHERE class_id = $1 AND date = $2`,
      [targetClass.id, date]
    );

    if (countResult.rows[0].count >= 2) {
      return res.status(400).json({ message: "해당 날짜는 이미 2명이 예약했습니다." });
    }

    try {
      await pool.query(
        `INSERT INTO reservations (class_id, date, name)
         VALUES ($1, $2, $3)`,
        [targetClass.id, date, name]
      );
    } catch (insertError) {
      if (insertError.code === "23505") {
        return res.status(400).json({ message: "이미 해당 날짜를 예약했습니다." });
      }
      throw insertError;
    }

    res.json({ message: "예약 완료" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "예약 실패" });
  }
});

/**
 * 학생 예약 취소 금지
 */
app.post("/api/cancel", (req, res) => {
  return res.status(403).json({
    message: "학생 예약 취소는 불가능합니다. 관리자만 취소할 수 있습니다."
  });
});

/**
 * 서브 관리자 로그인
 */
app.post("/api/subadmin/login", async (req, res) => {
  try {
    const { grade, classNo, password } = req.body;

    const targetClass = await getClassByGradeAndNo(Number(grade), Number(classNo));
    if (!targetClass) {
      return res.status(404).json({ message: "해당 반이 없습니다." });
    }

    if ((targetClass.sub_admin_password || "0000") !== (password || "")) {
      return res.status(401).json({ message: "서브 관리자 비밀번호가 올바르지 않습니다." });
    }

    res.json({
      message: "서브 관리자 로그인 성공",
      classId: targetClass.id,
      grade: targetClass.grade,
      classNo: targetClass.class_no
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "서브 관리자 로그인 실패" });
  }
});

/**
 * 서브 관리자 대시보드
 */
app.get("/api/subadmin/dashboard", async (req, res) => {
  try {
    const grade = Number(req.query.grade);
    const classNo = Number(req.query.classNo);

    if (!grade || !classNo) {
      return res.status(400).json({ message: "학년과 반 정보가 필요합니다." });
    }

    const targetClass = await getClassByGradeAndNo(grade, classNo);
    if (!targetClass) {
      return res.status(404).json({ message: "해당 반이 없습니다." });
    }

    const students = await getStudentsByClassId(targetClass.id);
    const today = getTodayStr();

    const reservationResult = await pool.query(
      `SELECT date, name FROM reservations
       WHERE class_id = $1 AND date >= $2
       ORDER BY date ASC, name ASC`,
      [targetClass.id, today]
    );

    const assignmentResult = await pool.query(
      `SELECT date, name FROM admin_assignments
       WHERE class_id = $1 AND date >= $2
       ORDER BY date ASC, name ASC`,
      [targetClass.id, today]
    );

    const reservations = {};
    for (const row of reservationResult.rows) {
      if (!reservations[row.date]) {
        reservations[row.date] = [];
      }
      reservations[row.date].push(row.name);
    }

    const assignments = {};
    for (const row of assignmentResult.rows) {
      if (!assignments[row.date]) {
        assignments[row.date] = [];
      }
      assignments[row.date].push(row.name);
    }

    res.json({
      classInfo: {
        grade: targetClass.grade,
        classNo: targetClass.class_no,
        accessPassword: targetClass.access_password || "",
        subAdminPassword: targetClass.sub_admin_password || "0000"
      },
      students,
      reservations,
      assignments
    });
  } catch (error) {
    console.error("서브 관리자 대시보드 오류:", error);
    res.status(500).json({ message: "서브 관리자 대시보드 조회 실패" });
  }
});

/**
 * 서브 관리자: 학생 명렬표 저장
 */
app.post("/api/subadmin/students", async (req, res) => {
  try {
    const { grade, classNo, password, names } = req.body;

    const targetClass = await getClassByGradeAndNo(Number(grade), Number(classNo));
    if (!targetClass) {
      return res.status(404).json({ message: "해당 반이 없습니다." });
    }

    if ((targetClass.sub_admin_password || "0000") !== (password || "")) {
      return res.status(401).json({ message: "서브 관리자 인증 실패" });
    }

    const safeNames = Array.isArray(names)
      ? [...new Set(names.map(name => String(name).trim()).filter(Boolean))]
      : [];

    await pool.query(`DELETE FROM students WHERE class_id = $1`, [targetClass.id]);

    for (const name of safeNames) {
      await pool.query(
        `INSERT INTO students (class_id, name) VALUES ($1, $2)`,
        [targetClass.id, name]
      );
    }

    await pool.query(`
      DELETE FROM reservations
      WHERE class_id = $1
      AND name NOT IN (SELECT name FROM students WHERE class_id = $1)
    `, [targetClass.id]);

    await pool.query(`
      DELETE FROM admin_assignments
      WHERE class_id = $1
      AND name NOT IN (SELECT name FROM students WHERE class_id = $1)
    `, [targetClass.id]);

    res.json({ message: "학생 명렬표 저장 완료" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "학생 명렬표 저장 실패" });
  }
});

/**
 * 서브 관리자: 반 접속 비밀번호 설정
 */
app.post("/api/subadmin/access-password", async (req, res) => {
  try {
    const { grade, classNo, password, accessPassword } = req.body;

    const targetClass = await getClassByGradeAndNo(Number(grade), Number(classNo));
    if (!targetClass) {
      return res.status(404).json({ message: "해당 반이 없습니다." });
    }

    if ((targetClass.sub_admin_password || "0000") !== (password || "")) {
      return res.status(401).json({ message: "서브 관리자 인증 실패" });
    }

    await pool.query(
      `UPDATE classes SET access_password = $1 WHERE id = $2`,
      [accessPassword || "", targetClass.id]
    );

    res.json({ message: "반 접속 비밀번호 저장 완료" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "반 접속 비밀번호 저장 실패" });
  }
});

/**
 * 서브 관리자: 날짜별 관리자 배정 추가
 */
app.post("/api/subadmin/assignments", async (req, res) => {
  try {
    const { grade, classNo, password, name, dates } = req.body;

    const targetClass = await getClassByGradeAndNo(Number(grade), Number(classNo));
    if (!targetClass) {
      return res.status(404).json({ message: "해당 반이 없습니다." });
    }

    if ((targetClass.sub_admin_password || "0000") !== (password || "")) {
      return res.status(401).json({ message: "서브 관리자 인증 실패" });
    }

    const students = await getStudentsByClassId(targetClass.id);
    if (!students.includes(name)) {
      return res.status(400).json({ message: "해당 반에 등록된 학생만 배정할 수 있습니다." });
    }

    if (!Array.isArray(dates) || dates.length === 0) {
      return res.status(400).json({ message: "날짜를 하나 이상 선택해주세요." });
    }

    let successCount = 0;

    for (const date of dates) {
      if (await isBlockedDate(date)) {
        continue;
      }

      try {
        await pool.query(
          `INSERT INTO admin_assignments (class_id, date, name)
           VALUES ($1, $2, $3)`,
          [targetClass.id, date, name]
        );
        successCount++;
      } catch (error) {
        if (error.code !== "23505") {
          throw error;
        }
      }
    }

    res.json({ message: `${successCount}개의 날짜에 관리자 배정을 저장했습니다.` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "관리자 배정 저장 실패" });
  }
});

/**
 * 서브 관리자: 관리자 배정 삭제
 */
app.post("/api/subadmin/assignments/delete", async (req, res) => {
  try {
    const { grade, classNo, password, date, name } = req.body;

    const targetClass = await getClassByGradeAndNo(Number(grade), Number(classNo));
    if (!targetClass) {
      return res.status(404).json({ message: "해당 반이 없습니다." });
    }

    if ((targetClass.sub_admin_password || "0000") !== (password || "")) {
      return res.status(401).json({ message: "서브 관리자 인증 실패" });
    }

    await pool.query(
      `DELETE FROM admin_assignments
       WHERE class_id = $1 AND date = $2 AND name = $3`,
      [targetClass.id, date, name]
    );

    res.json({ message: "관리자 배정 삭제 완료" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "관리자 배정 삭제 실패" });
  }
});

/**
 * 서브 관리자: 예약 개별 삭제
 */
app.post("/api/subadmin/reservations/delete", async (req, res) => {
  try {
    const { grade, classNo, password, date, name } = req.body;

    const targetClass = await getClassByGradeAndNo(Number(grade), Number(classNo));
    if (!targetClass) {
      return res.status(404).json({ message: "해당 반이 없습니다." });
    }

    if ((targetClass.sub_admin_password || "0000") !== (password || "")) {
      return res.status(401).json({ message: "서브 관리자 인증 실패" });
    }

    await pool.query(
      `DELETE FROM reservations
       WHERE class_id = $1 AND date = $2 AND name = $3`,
      [targetClass.id, date, name]
    );

    res.json({ message: "예약 삭제 완료" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "예약 삭제 실패" });
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
