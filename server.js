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

    // 원하는 학급 목록 만들기
    const wanted = [];
    for (const grade of [1, 2, 3]) {
      for (let classNo = 1; classNo <= counts[grade]; classNo++) {
        wanted.push({ grade, classNo });
      }
    }

    // 현재 DB의 학급 목록 가져오기
    const currentResult = await pool.query(
      `SELECT id, grade, class_no FROM classes ORDER BY grade ASC, class_no ASC`
    );
    const currentClasses = currentResult.rows;

    // 삭제 대상 찾기: 원하는 목록에 없는 기존 반
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
        [item.grade, item.classNo, ""]
      );
    }

    res.json({ message: "학년별 학급 구조 생성 완료" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "학급 구조 생성 실패" });
  }
});
