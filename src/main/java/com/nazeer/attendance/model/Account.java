package com.nazeer.attendance.model;

public class Account {
    public String id;
    public String role;        // ADMIN or CLIENT
    public String username;
    public String password;
    public String companyCode;
    public String companyName;

    public Account() {}

    public Account(String id, String role, String username, String password, String companyCode, String companyName) {
        this.id = id;
        this.role = role;
        this.username = username;
        this.password = password;
        this.companyCode = companyCode;
        this.companyName = companyName;
    }
}
