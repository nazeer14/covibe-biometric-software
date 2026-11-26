package com.nazeer.attendance.model;

public class Employee {
    public String employeeId;
    public String name;
    public String clientId;
    public String department;

    public Employee() {}

    public Employee(String employeeId, String name, String clientId, String department) {
        this.employeeId = employeeId;
        this.name = name;
        this.clientId = clientId;
        this.department = department;
    }

    public static String maskName(String fullName) {
        return fullName == null ? "" : fullName.trim();
    }
//
//    public static String maskName(String fullName) {
//        if (fullName == null || fullName.isBlank()) return "Un####n";
//        String c = fullName.trim();
//        if (c.length() <= 2) return c.charAt(0) + "####";
//        if (c.length() == 3) return c.substring(0, 2) + "####";
//        return c.substring(0, 2) + "####" + c.charAt(c.length() - 1);
//    }
//

}
