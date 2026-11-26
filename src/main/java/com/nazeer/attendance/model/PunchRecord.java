package com.nazeer.attendance.model;

public class PunchRecord {
    public String employeeId;
    public String punchTime; // yyyy-MM-dd HH:mm:ss
    public String rawField3;
    public String rawField4;
    public String rawField5; // 15 = Face Check-In, 1 = Fingerprint Check-Out, 4 = RFID Card
    public String rawField6;
    public String sourceFile;

    public PunchRecord() {}

    public PunchRecord(String employeeId, String punchTime, String rawField3,
                       String rawField4, String rawField5, String rawField6, String sourceFile) {
        this.employeeId = employeeId;
        this.punchTime = punchTime;
        this.rawField3 = rawField3;
        this.rawField4 = rawField4;
        this.rawField5 = rawField5;
        this.rawField6 = rawField6;
        this.sourceFile = sourceFile;
    }
}
