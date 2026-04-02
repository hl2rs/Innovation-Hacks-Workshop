import React from "react";
import "./StaticEarth.css";

export default function StaticEarth() {
  return (
    <div className="static-earth" aria-hidden="true">
      <svg className="static-earth-svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
        <defs>
          <radialGradient id="staticEarthOcean" cx="50%" cy="45%" r="65%">
            <stop offset="0%" stopColor="#4fb6ff" />
            <stop offset="42%" stopColor="#1478c9" />
            <stop offset="100%" stopColor="#08325c" />
          </radialGradient>
          <linearGradient id="staticEarthAtmosphere" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(198, 232, 255, 0.7)" />
            <stop offset="100%" stopColor="rgba(109, 170, 255, 0.05)" />
          </linearGradient>
          <clipPath id="staticEarthPlanetMask">
            <ellipse cx="800" cy="450" rx="720" ry="455" />
          </clipPath>
        </defs>

        <rect width="1600" height="900" fill="#05080c" />
        <ellipse cx="800" cy="450" rx="760" ry="500" fill="url(#staticEarthAtmosphere)" opacity="0.34" />
        <ellipse cx="800" cy="450" rx="720" ry="455" fill="url(#staticEarthOcean)" />

        <g clipPath="url(#staticEarthPlanetMask)">
          <path
            d="M255 276C318 246 394 238 468 252C523 262 587 292 601 336C613 372 579 414 530 434C474 458 406 466 352 506C299 544 252 616 194 603C141 592 129 504 126 442C123 367 184 312 255 276Z"
            fill="#61b76f"
          />
          <path
            d="M424 536C463 523 518 532 544 566C566 594 556 637 528 667C499 699 453 721 415 701C377 680 347 629 359 588C369 557 394 545 424 536Z"
            fill="#5baa68"
          />
          <path
            d="M724 255C770 223 845 206 902 222C955 238 992 274 1034 299C1083 328 1152 337 1173 389C1191 433 1158 481 1114 513C1071 544 1018 560 980 596C935 639 911 714 850 731C782 750 722 681 700 618C680 561 699 504 680 447C660 384 660 318 724 255Z"
            fill="#77ca77"
          />
          <path
            d="M1106 286C1141 255 1203 242 1248 258C1290 273 1318 305 1350 325C1392 351 1455 363 1468 411C1483 464 1440 514 1394 547C1350 578 1296 591 1251 577C1207 563 1173 522 1137 486C1094 443 1038 400 1045 351C1050 323 1078 307 1106 286Z"
            fill="#69c07c"
          />
          <path
            d="M1241 629C1273 607 1322 602 1361 615C1400 628 1431 658 1432 695C1433 731 1402 760 1366 772C1330 784 1286 781 1250 767C1216 754 1183 731 1180 695C1178 664 1212 647 1241 629Z"
            fill="#76cb86"
          />
          <path
            d="M635 206C661 186 700 176 728 185C756 194 768 223 754 245C739 269 704 281 672 276C641 272 612 252 609 228C607 218 619 212 635 206Z"
            fill="#7cd0a2"
          />

          <g opacity="0.22" stroke="#dff6ff" strokeWidth="6" fill="none">
            <path d="M136 428C303 387 471 372 637 383C782 392 922 420 1062 424C1209 429 1349 406 1493 374" />
            <path d="M195 276C392 231 598 229 799 248C973 265 1145 301 1322 296" />
            <path d="M239 598C396 558 563 541 726 547C880 553 1030 584 1181 600C1282 612 1385 612 1484 598" />
          </g>
        </g>

        <ellipse cx="800" cy="450" rx="720" ry="455" fill="none" stroke="rgba(214, 238, 255, 0.26)" strokeWidth="8" />
      </svg>
      <div className="static-earth-vignette" />
    </div>
  );
}