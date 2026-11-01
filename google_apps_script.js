/**
 * קוד Google Apps Script לחיבור קטלוג הספרים ל-Google Sheets
 * 
 * הוראות התקנה תוך 2 דקות:
 * 1. פתח גיליון Google Sheets חדש (למשל: "ספרי אמא ז״ל - בקשות").
 * 2. בשורה הראשונה רשום כותרות:
 *    A: תאריך ושעה | B: מס' ארגז | C: שם הספר | D: נבחר ע״י | E: טלפון / קשר | F: הערות
 * 3. לחץ בתפריט העליון על: Extensions -> Apps Script (הרחבות -> Apps Script).
 * 4. מחק את מה שיש שם והדבק את כל הקוד הזה.
 * 5. לחץ על כפתור Deploy (פריסה) -> New deployment (פריסה חדשה).
 * 6. בחר סוג Web app (יישום אינטרנט).
 * 7. בהגדרה "Who has access" (למי יש גישה) בחר: "Anyone" (כל אחד).
 * 8. לחץ Deploy ואשר הרשאות (Authorize).
 * 9. העתק את ה-Web App URL שקיבלת והדבק אותו בהגדרות באתר הקטלוג!
 */

function doGet(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = sheet.getDataRange().getValues();
  var results = [];
  
  if (data.length > 1) {
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (row[0] || row[2]) { // אם יש תוכן
        results.push({
          timestamp: row[0] ? Utilities.formatDate(new Date(row[0]), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm") : "",
          boxId: row[1] || "",
          bookTitle: row[2] || "",
          userName: row[3] || "",
          userPhone: row[4] || "",
          notes: row[5] || ""
        });
      }
    }
  }
  
  return ContentService.createTextOutput(JSON.stringify({ status: "success", data: results }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var body = JSON.parse(e.postData.contents);
    
    var timestamp = new Date();
    var boxId = body.boxId || "";
    var bookTitle = body.bookTitle || "";
    var userName = body.userName || "";
    var userPhone = body.userPhone || "";
    var notes = body.notes || "";
    
    sheet.appendRow([timestamp, boxId, bookTitle, userName, userPhone, notes]);
    
    return ContentService.createTextOutput(JSON.stringify({ status: "success", message: "נשמר בהצלחה!" }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
