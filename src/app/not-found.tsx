"use client";

import Link from "next/link";
import { motion } from "framer-motion";

export default function NotFound() {
  const containerVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.2, // Time between each element appearing
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 30 },
    show: {
      opacity: 1,
      y: 0,
      transition: {
        type: "spring",
        stiffness: 100,
        damping: 15,
      },
    },
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        background: "#09090b",
        fontFamily: "var(--font-mono), monospace",
        textAlign: "center",
        overflow: "hidden", // Prevent scrollbars during animation
      }}
    >
      <style
        dangerouslySetInnerHTML={{
          __html: `
            .brutal-btn {
              display: inline-block;
              background: #fff;
              color: #000;
              padding: 1rem 2rem;
              font-family: var(--font-mono), monospace;
              font-weight: 700;
              font-size: 1rem;
              text-transform: uppercase;
              text-decoration: none;
              border: 2px solid #fff;
              box-shadow: 6px 6px 0 oklch(0.7 0.15 155);
              transition: transform 100ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 100ms cubic-bezier(0.4, 0, 0.2, 1), background 500ms ease-out;
              margin-top: 2rem;
            }
            .brutal-btn:active {
              transform: translate(6px, 6px);
              box-shadow: 0px 0px 0 oklch(0.7 0.15 155);
            }
            .brutal-btn:hover {
              background: oklch(0.7 0.15 155);
            }
            .ascii-block {
              font-family: monospace;
              font-size: 1.5rem;
              line-height: 1.2;
              color: oklch(0.7 0.15 155);
              white-space: pre;
              text-align: left;
              margin-bottom: 2rem;
            }
            .title {
              font-size: clamp(3rem, 10vw, 7rem);
              font-weight: 900;
              text-transform: uppercase;
              color: transparent;
              -webkit-text-stroke: 2px #fff;
              line-height: 1;
              margin: 0;
              letter-spacing: -2px;
            }
            @media (max-width: 600px) {
              .ascii-block {
                font-size: 1rem;
              }
              .title {
                -webkit-text-stroke: 1px #fff;
              }
            }
          `,
        }}
      />

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="show"
        style={{ display: "flex", flexDirection: "column", alignItems: "center" }}
      >
        <motion.div variants={itemVariants} className="ascii-block">
          {`   +--------+
  /        /|
 +--------+ |
 |        | +
 |  404   |/
 +--------+`}
        </motion.div>

        <motion.h1 variants={itemVariants} className="title">
          ORPHANED_
        </motion.h1>

        <motion.p
          variants={itemVariants}
          style={{
            fontSize: "1rem",
            color: "#999",
            maxWidth: "400px",
            marginTop: "1.5rem",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            lineHeight: 1.6,
          }}
        >
          Error: Block not found. <br />
          The validators have rejected your reality.
        </motion.p>

        <motion.div variants={itemVariants}>
          <Link href="/" className="brutal-btn">
            [ RETURN_TO_GENESIS ]
          </Link>
        </motion.div>
      </motion.div>
    </div>
  );
}
